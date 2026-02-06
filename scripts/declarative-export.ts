import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { exportDeclarativeSchema } from "../src/core/export/index.ts";
import { compileSerializeDSL } from "../src/core/integrations/serialize/dsl.ts";
import { supabase } from "../src/core/integrations/supabase.ts";
import { createPlan } from "../src/core/plan/index.ts";

const sourceUrl = process.env.SOURCE_URL!;
const targetUrl = process.env.TARGET_URL!;
const outputDir = path.resolve("declarative-schemas");

try {
  const planResult = await createPlan(sourceUrl, targetUrl, {
    filter: supabase.filter,
    serialize: supabase.serialize,
  });

  if (!planResult) {
    console.log("No changes detected.");
    process.exit(0);
  }

  // Compile the serialize DSL into a function for the declarative export
  const serializeFunction = supabase.serialize
    ? compileSerializeDSL(supabase.serialize)
    : undefined;

  // Types from system schemas that we can't create due to permissions.
  // Changes that depend on these types (directly or transitively) will be filtered out.
  // This includes functions with these types in their signatures, and comments on those functions.
  const SYSTEM_TYPE_PATTERNS = [
    /^type:auth\./, // type:auth.action, etc.
    /^type:extensions\./, // type:extensions.*, etc.
    /^type:pg_catalog\./, // type:pg_catalog.*, etc.
    /auth\.[a-z_]+(\[\])?/, // auth.action in function signatures
  ];

  // Filter to exclude changes that depend on types from system schemas.
  // These changes can't be applied because we can't create the types they depend on.
  const requiresFilter = (dependency: string) => {
    // Check if any system type pattern matches this dependency
    for (const pattern of SYSTEM_TYPE_PATTERNS) {
      if (pattern.test(dependency)) {
        return false;
      }
    }
    return true;
  };

  // Functions known to have auth dependencies. Used to filter wrapper functions
  // that call these functions but don't have direct auth references in their SQL.
  // These are functions where all overloads have auth dependencies.
  const AUTH_DEPENDENT_FUNCTIONS = [
    "assign_role",
    "delete_member",
    "delete_subject_role",
    "delete_organization_role",
    "delete_permission",
    "delete_role",
    "insert_organization_role",
    "get_organization_role",
    "get_user",
    "can_for_organization_id",
  ];

  // Languages that are not available in the local environment.
  // Functions using these languages will be filtered out.
  const UNAVAILABLE_LANGUAGES = ["plv8", "plcoffee", "plls"];

  // C function libraries that aren't available locally (extension-provided)
  const EXTENSION_LIBRARIES = ["pgcrypto", "pgjwt", "pgvector", "supautils"];

  // Functions from extensions that aren't available locally
  const UNAVAILABLE_FUNCTIONS = [
    "gen_random_uuid", // pgcrypto (use native gen_random_uuid() instead)
  ];

  // PostgREST objects that are managed by Supabase, not user schema
  const PGRST_OBJECTS = [
    "pgrst_ddl_watch",
    "pgrst_drop_watch",
  ];

  // Filter to exclude changes whose SQL references auth schema objects directly.
  // This catches cases like policy definitions that cast to auth.action,
  // or plpgsql functions that reference auth.* tables.
  const sqlFilter = (sql: string) => {
    // Check for PostgREST managed objects
    for (const obj of PGRST_OBJECTS) {
      if (sql.includes(obj)) {
        return false;
      }
    }
    // Check for functions using unavailable languages
    for (const lang of UNAVAILABLE_LANGUAGES) {
      const pattern = new RegExp(`LANGUAGE\\s+${lang}\\b`, "i");
      if (pattern.test(sql)) {
        return false;
      }
    }
    // Check for C functions that load from extension libraries
    // These won't work without the extension being installed
    for (const lib of EXTENSION_LIBRARIES) {
      const pattern = new RegExp(`\\$libdir/${lib}`, "i");
      if (pattern.test(sql)) {
        return false;
      }
    }
    // Check for calls to unavailable extension functions
    for (const fn of UNAVAILABLE_FUNCTIONS) {
      // Match both qualified (public.gen_random_uuid) and unqualified (gen_random_uuid)
      const pattern = new RegExp(`\\b${fn}\\s*\\(`, "i");
      if (pattern.test(sql)) {
        return false;
      }
    }
    // Check for type casts to auth types (e.g., ::auth.action)
    if (/::auth\.[a-z_]+/i.test(sql)) {
      return false;
    }
    // Check for auth.* or audit.* schema references in function/trigger bodies
    // Match patterns like: auth.roles, auth.role_members, audit.insert_update_delete_trigger()
    // Use word boundary to avoid matching auth_admin, etc.
    if (/\b(auth|audit)\.[a-z_]+/i.test(sql)) {
      return false;
    }
    // Check for calls to known auth-dependent functions
    // These are wrapper functions that call other functions which have auth dependencies
    for (const fnName of AUTH_DEPENDENT_FUNCTIONS) {
      // Match public.function_name( pattern to catch qualified function calls
      const pattern = new RegExp(`\\bpublic\\.${fnName}\\s*\\(`, "i");
      if (pattern.test(sql)) {
        return false;
      }
    }
    return true;
  };

  const output = exportDeclarativeSchema(planResult, {
    integration: serializeFunction
      ? { serialize: serializeFunction }
      : undefined,
    requiresFilter,
    sqlFilter,
  });

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  for (const file of output.files) {
    const filePath = path.join(outputDir, file.path);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, file.sql);
  }

  const orderPath = path.join(outputDir, "order.json");
  const orderedFiles = output.files.map((file) => file.path);
  await writeFile(orderPath, `${JSON.stringify(orderedFiles, null, 2)}\n`);

  // Generate a single combined SQL file with all statements in the correct order.
  // This is useful for tools that apply files alphabetically and don't support
  // custom ordering.
  const combinedSql = output.files
    .map((file) => `-- File: ${file.path}\n${file.sql}`)
    .join("\n\n");
  await writeFile(path.join(outputDir, "combined.sql"), combinedSql);

  console.log(`Wrote ${output.files.length} files to ${outputDir}`);
} catch (error) {
  console.error("Error:", error);
  process.exit(1);
}
