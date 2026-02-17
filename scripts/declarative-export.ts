import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Change } from "../src/core/change.types.ts";
import { exportDeclarativeSchema } from "../src/core/export/index.ts";
import {
  compileFilterDSL,
  evaluatePattern,
} from "../src/core/integrations/filter/dsl.ts";
import type { Integration } from "../src/core/integrations/integration.types.ts";
import { compileSerializeDSL } from "../src/core/integrations/serialize/dsl.ts";
import { supabase } from "../src/core/integrations/supabase.ts";
import { createPlan } from "../src/core/plan/index.ts";

const sourceUrl = process.env.SOURCE_URL;
const targetUrl = process.env.TARGET_URL;
if (!sourceUrl || !targetUrl) {
  throw new Error(
    "SOURCE_URL and TARGET_URL environment variables are required",
  );
}
const outputDir = path.resolve(process.env.OUTPUT_DIR ?? "declarative-schemas");
const integrationEnv = process.env.INTEGRATION;

try {
  let planResult: Awaited<ReturnType<typeof createPlan>>;
  let exportIntegration: Integration | undefined;

  if (integrationEnv === "supabase") {
    const filterFn = supabase.filter
      ? compileFilterDSL(supabase.filter)
      : undefined;
    const serializeFn = supabase.serialize
      ? compileSerializeDSL(supabase.serialize)
      : undefined;
    planResult = await createPlan(sourceUrl, targetUrl, {
      filter: filterFn,
      serialize: serializeFn,
    });
    exportIntegration =
      serializeFn !== undefined ? { serialize: serializeFn } : undefined;
  } else {
    // Default: platform-db compatibility filter. Exclude extensions that
    // require shared_preload_libraries in postgresql.conf.
    const platformDbExclusions = {
      or: [
        {
          type: "extension" as const,
          extension: ["pgaudit", "pg_cron", "plv8", "pg_stat_statements"],
        },
        { procedureLanguage: ["plv8"] },
      ],
    };
    const filter = (change: Change) =>
      !evaluatePattern(platformDbExclusions, change);
    planResult = await createPlan(sourceUrl, targetUrl, { filter });
  }

  if (!planResult) {
    console.log("No changes detected.");
    process.exit(0);
  }

  // No orderPrefix needed: execution order is resolved at apply time by
  // pg-topo (static dependency analysis) + round-based engine. The export
  // focuses purely on clean, human-friendly file grouping.
  const output = exportDeclarativeSchema(planResult, {
    integration: exportIntegration,
    formatOptions: {
      keywordCase: "lower",
      maxWidth: 180,
      indent: 4,
    },
    // Entity grouping: merge partitioned tables automatically and group
    // related entities by regex patterns. First match wins.
    grouping: {
      mode: "single-file",
      autoGroupPartitions: true,
      groupPatterns: [
        // Contains-style (substring)
        { pattern: /project/, name: "project" },
        { pattern: /wal/, name: "wal" },
        { pattern: /kubernetes/, name: "kubernetes" },
        // Prefix-style (startsWith)
        { pattern: /^orb/, name: "orb" },
        { pattern: /^auth/, name: "auth" },
        { pattern: /^custom/, name: "custom" },
        { pattern: /^credit/, name: "credit" },
        { pattern: /user/, name: "user" },
        { pattern: /^oauth/, name: "oauth" },
        { pattern: /^can/, name: "can" },
        { pattern: /billing/, name: "billing" },
        { pattern: /organization/, name: "organization" },
        // Suffix-style (endsWith)
        { pattern: /keys$/, name: "keys" },
      ],
      // Flat schemas: small or extension schemas where each category is a
      // single file (e.g. schemas/partman/tables.sql instead of per-object files).
      flatSchemas: [
        "partman",
        "pgboss",
        "openfga",
        "audit",
        "extensions",
        "audit",
        "auth",
        "extensions",
        "integrations",
        "orb",
        "pgboss",
        "stripe",
      ],
    },
  });

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  for (const file of output.files) {
    const filePath = path.join(outputDir, file.path);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, file.sql);
  }

  console.log(
    `Wrote ${planResult.sortedChanges.length} changes to ${output.files.length} files to ${outputDir}`,
  );
} catch (error) {
  console.error("Error:", error);
  process.exit(1);
}
