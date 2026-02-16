import { describe, expect, it } from "vitest";
import type { Change } from "../change.types.ts";
import {
  type CompiledPattern,
  applyGrouping,
  compilePatterns,
  createFileMapper,
  flattenSchema,
  resolveGroupName,
} from "./file-mapper.ts";
import type { FilePath } from "./types.ts";

// ============================================================================
// Helpers – minimal Change stubs
// ============================================================================

/** Minimal table change stub with partition info. */
function tableChange(opts: {
  schema: string;
  name: string;
  isPartition?: boolean;
  parentName?: string | null;
  parentSchema?: string | null;
}): Change {
  return {
    objectType: "table",
    operation: "create",
    scope: "object",
    table: {
      schema: opts.schema,
      name: opts.name,
      is_partition: opts.isPartition ?? false,
      parent_name: opts.parentName ?? null,
      parent_schema: opts.parentSchema ?? null,
    },
    serialize: () => `CREATE TABLE ${opts.schema}.${opts.name} ()`,
  } as unknown as Change;
}

/** Build a FilePath for a schema-scoped table. */
function tableFP(objectName: string, schema = "public"): FilePath {
  return {
    path: `schemas/${schema}/tables/${objectName}.sql`,
    category: "tables",
    metadata: { objectType: "table", schemaName: schema, objectName },
  };
}

// ============================================================================
// compilePatterns
// ============================================================================

describe("compilePatterns", () => {
  it("compiles string patterns to RegExp", () => {
    const compiled = compilePatterns([
      { pattern: "^project", name: "project" },
    ]);
    expect(compiled).toHaveLength(1);
    expect(compiled[0].regex).toBeInstanceOf(RegExp);
    expect(compiled[0].regex.test("project_claim")).toBe(true);
    expect(compiled[0].name).toBe("project");
  });

  it("passes RegExp patterns through unchanged", () => {
    const re = /^kubernetes/;
    const compiled = compilePatterns([{ pattern: re, name: "kubernetes" }]);
    expect(compiled[0].regex).toBe(re);
  });
});

// ============================================================================
// resolveGroupName
// ============================================================================

describe("resolveGroupName", () => {
  const noPatterns: CompiledPattern[] = [];

  it("returns null for cluster-level objects (no schemaName)", () => {
    const filePath: FilePath = {
      path: "cluster/roles.sql",
      category: "cluster",
      metadata: { objectType: "role" },
    };
    const change = { objectType: "role" } as unknown as Change;
    const patterns = compilePatterns([{ pattern: /role/, name: "role" }]);
    expect(resolveGroupName(change, filePath, patterns, true)).toBeNull();
  });

  it("returns null when no patterns match", () => {
    const change = tableChange({ schema: "public", name: "users" });
    expect(
      resolveGroupName(change, tableFP("users"), noPatterns, false),
    ).toBeNull();
  });

  // ---------- Auto-detect partitions ----------

  describe("auto-detect partitions", () => {
    it("detects partitioned table and returns parent name", () => {
      const change = tableChange({
        schema: "public",
        name: "events_p20260107",
        isPartition: true,
        parentName: "events",
        parentSchema: "public",
      });
      expect(
        resolveGroupName(
          change,
          tableFP("events_p20260107"),
          noPatterns,
          true,
        ),
      ).toBe("events");
    });

    it("skips auto-detection when autoPartitions is false", () => {
      const change = tableChange({
        schema: "public",
        name: "events_p20260107",
        isPartition: true,
        parentName: "events",
        parentSchema: "public",
      });
      expect(
        resolveGroupName(
          change,
          tableFP("events_p20260107"),
          noPatterns,
          false,
        ),
      ).toBeNull();
    });

    it("chains auto-detect parent name through regex patterns", () => {
      // Partition parent "kubernetes_resource_events" matches /^kubernetes/
      const change = tableChange({
        schema: "public",
        name: "kubernetes_resource_events_p20260107",
        isPartition: true,
        parentName: "kubernetes_resource_events",
        parentSchema: "public",
      });
      const patterns = compilePatterns([
        { pattern: /^kubernetes/, name: "kubernetes" },
      ]);
      expect(
        resolveGroupName(
          change,
          tableFP("kubernetes_resource_events_p20260107"),
          patterns,
          true,
        ),
      ).toBe("kubernetes");
    });

    it("falls back to parent name when no pattern matches", () => {
      const change = tableChange({
        schema: "public",
        name: "events_p20260107",
        isPartition: true,
        parentName: "events",
        parentSchema: "public",
      });
      const patterns = compilePatterns([
        { pattern: /^unrelated/, name: "unrelated" },
      ]);
      expect(
        resolveGroupName(
          change,
          tableFP("events_p20260107"),
          patterns,
          true,
        ),
      ).toBe("events");
    });
  });

  // ---------- Regex matching ----------

  describe("regex patterns", () => {
    it("matches prefix-style regex", () => {
      const change = tableChange({ schema: "public", name: "project_claim" });
      const patterns = compilePatterns([
        { pattern: /^project/, name: "project" },
      ]);
      expect(
        resolveGroupName(change, tableFP("project_claim"), patterns, false),
      ).toBe("project");
    });

    it("matches contains-style regex", () => {
      const change = tableChange({
        schema: "public",
        name: "get_organization_role",
      });
      const patterns = compilePatterns([
        { pattern: /organization/, name: "organization" },
      ]);
      expect(
        resolveGroupName(
          change,
          tableFP("get_organization_role"),
          patterns,
          false,
        ),
      ).toBe("organization");
    });

    it("matches suffix-style regex", () => {
      const change = tableChange({
        schema: "public",
        name: "access_tokens",
      });
      const patterns = compilePatterns([
        { pattern: /tokens$/, name: "tokens" },
      ]);
      expect(
        resolveGroupName(change, tableFP("access_tokens"), patterns, false),
      ).toBe("tokens");
    });

    it("matches plurals with prefix regex (users matches /^user/)", () => {
      const change = tableChange({ schema: "public", name: "users" });
      const patterns = compilePatterns([
        { pattern: /^user/, name: "user" },
      ]);
      expect(
        resolveGroupName(change, tableFP("users"), patterns, false),
      ).toBe("user");
    });

    it("first matching pattern wins (ordering controls priority)", () => {
      const change = tableChange({
        schema: "public",
        name: "organization_members",
      });
      // Both patterns match; first one wins.
      const patterns = compilePatterns([
        { pattern: /^organization/, name: "org-prefix" },
        { pattern: /organization/, name: "org-contains" },
      ]);
      expect(
        resolveGroupName(
          change,
          tableFP("organization_members"),
          patterns,
          false,
        ),
      ).toBe("org-prefix");
    });

    it("skips non-matching patterns and picks the first that matches", () => {
      const change = tableChange({
        schema: "public",
        name: "access_tokens",
      });
      const patterns = compilePatterns([
        { pattern: /^project/, name: "project" },
        { pattern: /tokens$/, name: "tokens" },
      ]);
      expect(
        resolveGroupName(change, tableFP("access_tokens"), patterns, false),
      ).toBe("tokens");
    });

    it("string patterns are compiled as regex", () => {
      const change = tableChange({
        schema: "public",
        name: "billing_invoices",
      });
      const patterns = compilePatterns([
        { pattern: "^billing", name: "billing" },
      ]);
      expect(
        resolveGroupName(
          change,
          tableFP("billing_invoices"),
          patterns,
          false,
        ),
      ).toBe("billing");
    });
  });
});

// ============================================================================
// applyGrouping
// ============================================================================

describe("applyGrouping", () => {
  const baseFilePath: FilePath = {
    path: "schemas/public/tables/wal_verification_results_p20260107.sql",
    category: "tables",
    metadata: {
      objectType: "table",
      schemaName: "public",
      objectName: "wal_verification_results_p20260107",
    },
  };

  describe("single-file mode", () => {
    it("replaces filename with group name in same category directory", () => {
      const result = applyGrouping(
        baseFilePath,
        "wal_verification_results",
        "single-file",
      );
      expect(result.path).toBe(
        "schemas/public/tables/wal_verification_results.sql",
      );
      expect(result.category).toBe("tables");
      expect(result.metadata.objectName).toBe("wal_verification_results");
      expect(result.metadata.schemaName).toBe("public");
    });
  });

  describe("subdirectory mode", () => {
    it("moves to group-named directory with category as filename", () => {
      const result = applyGrouping(
        baseFilePath,
        "wal_verification_results",
        "subdirectory",
      );
      expect(result.path).toBe(
        "schemas/public/wal_verification_results/tables.sql",
      );
      expect(result.category).toBe("tables");
      expect(result.metadata.objectName).toBe("wal_verification_results");
    });

    it("works for types category", () => {
      const typePath: FilePath = {
        path: "schemas/public/types/kubernetes_resource_event_type.sql",
        category: "types",
        metadata: {
          objectType: "enum",
          schemaName: "public",
          objectName: "kubernetes_resource_event_type",
        },
      };
      const result = applyGrouping(typePath, "kubernetes", "subdirectory");
      expect(result.path).toBe("schemas/public/kubernetes/types.sql");
    });

    it("works for functions category", () => {
      const funcPath: FilePath = {
        path: "schemas/public/functions/get_project_owner.sql",
        category: "functions",
        metadata: {
          objectType: "function",
          schemaName: "public",
          objectName: "get_project_owner",
        },
      };
      const result = applyGrouping(funcPath, "project", "subdirectory");
      expect(result.path).toBe("schemas/public/project/functions.sql");
    });
  });
});

// ============================================================================
// createFileMapper (end-to-end)
// ============================================================================

describe("createFileMapper", () => {
  it("returns getFilePath unchanged when no grouping is provided", () => {
    const mapper = createFileMapper(undefined);
    const change = tableChange({ schema: "public", name: "users" });
    expect(mapper(change).path).toBe("schemas/public/tables/users.sql");
  });

  it("groups partition tables into parent file (single-file mode)", () => {
    const mapper = createFileMapper({
      mode: "single-file",
      autoGroupPartitions: true,
    });

    const parent = tableChange({ schema: "public", name: "events" });
    expect(mapper(parent).path).toBe("schemas/public/tables/events.sql");

    const partition = tableChange({
      schema: "public",
      name: "events_p20260107",
      isPartition: true,
      parentName: "events",
      parentSchema: "public",
    });
    expect(mapper(partition).path).toBe("schemas/public/tables/events.sql");
  });

  it("groups partition tables into subdirectory (subdirectory mode)", () => {
    const mapper = createFileMapper({
      mode: "subdirectory",
      autoGroupPartitions: true,
    });

    const partition = tableChange({
      schema: "public",
      name: "events_p20260107",
      isPartition: true,
      parentName: "events",
      parentSchema: "public",
    });
    expect(mapper(partition).path).toBe("schemas/public/events/tables.sql");
  });

  it("groups by prefix regex (single-file mode)", () => {
    const mapper = createFileMapper({
      mode: "single-file",
      autoGroupPartitions: false,
      groupPatterns: [{ pattern: /^project/, name: "project" }],
    });

    const change = tableChange({
      schema: "public",
      name: "project_claim_tokens",
    });
    expect(mapper(change).path).toBe("schemas/public/tables/project.sql");
  });

  it("groups by contains regex (subdirectory mode)", () => {
    const mapper = createFileMapper({
      mode: "subdirectory",
      autoGroupPartitions: false,
      groupPatterns: [{ pattern: /organization/, name: "organization" }],
    });

    const change = tableChange({
      schema: "public",
      name: "get_organization_role",
    });
    expect(mapper(change).path).toBe(
      "schemas/public/organization/tables.sql",
    );
  });

  it("groups by suffix regex (single-file mode)", () => {
    const mapper = createFileMapper({
      mode: "single-file",
      autoGroupPartitions: false,
      groupPatterns: [{ pattern: /tokens$/, name: "tokens" }],
    });

    const change = tableChange({ schema: "public", name: "access_tokens" });
    expect(mapper(change).path).toBe("schemas/public/tables/tokens.sql");
  });

  it("does not group unrelated tables", () => {
    const mapper = createFileMapper({
      mode: "single-file",
      autoGroupPartitions: true,
      groupPatterns: [{ pattern: /^project/, name: "project" }],
    });

    const change = tableChange({ schema: "public", name: "users" });
    expect(mapper(change).path).toBe("schemas/public/tables/users.sql");
  });

  it("first pattern wins when multiple match", () => {
    const mapper = createFileMapper({
      mode: "single-file",
      autoGroupPartitions: false,
      groupPatterns: [
        { pattern: /^organization/, name: "org-prefix" },
        { pattern: /organization/, name: "org-contains" },
      ],
    });

    const change = tableChange({
      schema: "public",
      name: "organization_members",
    });
    expect(mapper(change).path).toBe(
      "schemas/public/tables/org-prefix.sql",
    );
  });

  it("chains partition auto-detect through regex (kubernetes scenario)", () => {
    const mapper = createFileMapper({
      mode: "single-file",
      autoGroupPartitions: true,
      groupPatterns: [{ pattern: /^kubernetes/, name: "kubernetes" }],
    });

    // Parent table
    const parent = tableChange({
      schema: "public",
      name: "kubernetes_resource_events",
    });
    expect(mapper(parent).path).toBe(
      "schemas/public/tables/kubernetes.sql",
    );

    // Partition: auto-detect → parent "kubernetes_resource_events" → /^kubernetes/ matches
    const partition = tableChange({
      schema: "public",
      name: "kubernetes_resource_events_p20260107",
      isPartition: true,
      parentName: "kubernetes_resource_events",
      parentSchema: "public",
    });
    expect(mapper(partition).path).toBe(
      "schemas/public/tables/kubernetes.sql",
    );

    // Another kubernetes table
    const other = tableChange({
      schema: "public",
      name: "kubernetes_clusters",
    });
    expect(mapper(other).path).toBe(
      "schemas/public/tables/kubernetes.sql",
    );
  });

  it("all pattern types combined end-to-end", () => {
    const mapper = createFileMapper({
      mode: "subdirectory",
      autoGroupPartitions: false,
      groupPatterns: [
        { pattern: /^project/, name: "project" },
        { pattern: /organization/, name: "organization" },
        { pattern: /keys$/, name: "keys" },
      ],
    });

    // Prefix match
    const t1 = tableChange({ schema: "public", name: "project_claim_tokens" });
    expect(mapper(t1).path).toBe("schemas/public/project/tables.sql");

    // Contains match
    const t2 = tableChange({
      schema: "public",
      name: "get_organization_role",
    });
    expect(mapper(t2).path).toBe("schemas/public/organization/tables.sql");

    // Suffix match
    const t3 = tableChange({ schema: "public", name: "api_keys" });
    expect(mapper(t3).path).toBe("schemas/public/keys/tables.sql");

    // No match
    const t4 = tableChange({ schema: "public", name: "users" });
    expect(mapper(t4).path).toBe("schemas/public/tables/users.sql");
  });

  it("accepts string patterns (compiled as regex)", () => {
    const mapper = createFileMapper({
      mode: "single-file",
      autoGroupPartitions: false,
      groupPatterns: [{ pattern: "^billing", name: "billing" }],
    });

    const change = tableChange({
      schema: "public",
      name: "billing_invoices",
    });
    expect(mapper(change).path).toBe("schemas/public/tables/billing.sql");
  });
});

// ============================================================================
// flattenSchema
// ============================================================================

describe("flattenSchema", () => {
  it("collapses tables path to schemas/{schema}/tables.sql", () => {
    const fp: FilePath = {
      path: "schemas/partman/tables/template_public_events.sql",
      category: "tables",
      metadata: {
        objectType: "table",
        schemaName: "partman",
        objectName: "template_public_events",
      },
    };
    const result = flattenSchema(fp);
    expect(result.path).toBe("schemas/partman/tables.sql");
    expect(result.category).toBe("tables");
    expect(result.metadata.objectName).toBe("tables");
    expect(result.metadata.schemaName).toBe("partman");
  });

  it("collapses functions path to schemas/{schema}/functions.sql", () => {
    const fp: FilePath = {
      path: "schemas/pgboss/functions/some_function.sql",
      category: "functions",
      metadata: {
        objectType: "function",
        schemaName: "pgboss",
        objectName: "some_function",
      },
    };
    const result = flattenSchema(fp);
    expect(result.path).toBe("schemas/pgboss/functions.sql");
    expect(result.metadata.objectName).toBe("functions");
  });

  it("leaves schema.sql unchanged", () => {
    const fp: FilePath = {
      path: "schemas/partman/schema.sql",
      category: "schema",
      metadata: {
        objectType: "schema",
        schemaName: "partman",
        objectName: "partman",
      },
    };
    const result = flattenSchema(fp);
    expect(result).toBe(fp); // same reference -- untouched
  });
});

// ============================================================================
// createFileMapper -- flatSchemas
// ============================================================================

describe("createFileMapper with flatSchemas", () => {
  it("flattens tables in a flat schema to one file", () => {
    const mapper = createFileMapper({
      mode: "single-file",
      flatSchemas: ["partman"],
    });

    const t1 = tableChange({ schema: "partman", name: "template_public_events" });
    const t2 = tableChange({
      schema: "partman",
      name: "template_public_wal_verification_results",
    });

    expect(mapper(t1).path).toBe("schemas/partman/tables.sql");
    expect(mapper(t2).path).toBe("schemas/partman/tables.sql");
  });

  it("does not flatten schemas that are not in the flatSchemas list", () => {
    const mapper = createFileMapper({
      mode: "single-file",
      flatSchemas: ["partman"],
    });

    const change = tableChange({ schema: "public", name: "users" });
    expect(mapper(change).path).toBe("schemas/public/tables/users.sql");
  });

  it("flat schema takes priority over regex patterns", () => {
    const mapper = createFileMapper({
      mode: "single-file",
      flatSchemas: ["partman"],
      groupPatterns: [{ pattern: /^template/, name: "template" }],
    });

    // The table name matches the regex, but since the schema is flat, we
    // should get the flat path instead.
    const change = tableChange({
      schema: "partman",
      name: "template_public_events",
    });
    expect(mapper(change).path).toBe("schemas/partman/tables.sql");
  });

  it("leaves schema.sql unchanged for flat schemas", () => {
    const mapper = createFileMapper({
      mode: "single-file",
      flatSchemas: ["partman"],
    });

    // Simulate a schema-level change (not a table)
    const change = {
      objectType: "schema",
      operation: "create",
      scope: "object",
      schema: { name: "partman" },
      serialize: () => "CREATE SCHEMA partman",
    } as unknown as Change;

    const result = mapper(change);
    // schema.sql is not affected by flattening
    expect(result.path).toBe("schemas/partman/schema.sql");
  });

  it("regex patterns still apply to non-flat schemas", () => {
    const mapper = createFileMapper({
      mode: "subdirectory",
      flatSchemas: ["partman"],
      groupPatterns: [{ pattern: /^project/, name: "project" }],
    });

    // Flat schema → flattened
    const t1 = tableChange({ schema: "partman", name: "template_public_events" });
    expect(mapper(t1).path).toBe("schemas/partman/tables.sql");

    // Non-flat schema → regex patterns apply
    const t2 = tableChange({ schema: "public", name: "project_claim_tokens" });
    expect(mapper(t2).path).toBe("schemas/public/project/tables.sql");

    // Non-flat, non-matching → default
    const t3 = tableChange({ schema: "public", name: "users" });
    expect(mapper(t3).path).toBe("schemas/public/tables/users.sql");
  });
});
