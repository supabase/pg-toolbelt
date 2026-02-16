/**
 * Map changes to declarative schema file paths.
 */

import type { Change } from "../change.types.ts";
import {
  getObjectName,
  getObjectSchema,
  getParentInfo,
} from "../plan/serialize.ts";
import type { FileCategory, FilePath, Grouping } from "./types.ts";

// ============================================================================
// Helpers
// ============================================================================

type RoleDefaultPrivilegeChange = Change & {
  objectType: "role";
  scope: "default_privilege";
  inSchema: string | null;
};

function isRoleDefaultPrivilegeChange(
  change: Change,
): change is RoleDefaultPrivilegeChange {
  return (
    change.objectType === "role" &&
    change.scope === "default_privilege" &&
    "inSchema" in change
  );
}

function requireSchema(change: Change): string {
  const schema = getObjectSchema(change);
  if (!schema) {
    throw new Error(`Expected schema for ${change.objectType} change`);
  }
  return schema;
}

function schemaPath(schema: string, ...parts: string[]): string {
  return `schemas/${schema}/${parts.join("/")}`;
}

// ============================================================================
// File Path Mapping
// ============================================================================

export function getFilePath(change: Change): FilePath {
  switch (change.objectType) {
    case "role":
      if (isRoleDefaultPrivilegeChange(change) && change.inSchema) {
        const schemaName = change.inSchema;
        return {
          path: schemaPath(schemaName, "schema.sql"),
          category: "schema",
          metadata: {
            objectType: "default_privilege",
            schemaName,
            objectName: schemaName,
          },
        };
      }
      return {
        path: "cluster/roles.sql",
        category: "cluster",
        metadata: { objectType: "role" },
      };
    case "extension": {
      const extensionName = getObjectName(change);
      return {
        path: `cluster/extensions/${extensionName}.sql`,
        category: "extensions",
        metadata: { objectType: "extension", objectName: extensionName },
      };
    }
    case "foreign_data_wrapper":
    case "server":
    case "user_mapping":
      return {
        path: "cluster/foreign_data_wrappers.sql",
        category: "cluster",
        metadata: { objectType: change.objectType },
      };
    case "publication":
      return {
        path: "cluster/publications.sql",
        category: "cluster",
        metadata: { objectType: "publication" },
      };
    case "subscription":
      return {
        path: "cluster/subscriptions.sql",
        category: "cluster",
        metadata: { objectType: "subscription" },
      };
    case "event_trigger":
      return {
        path: "cluster/event_triggers.sql",
        category: "cluster",
        metadata: { objectType: "event_trigger" },
      };
    case "language":
      return {
        path: "cluster/languages.sql",
        category: "cluster",
        metadata: { objectType: "language" },
      };
    case "schema": {
      const schemaName = change.schema.name;
      return {
        path: schemaPath(schemaName, "schema.sql"),
        category: "schema",
        metadata: {
          objectType: "schema",
          schemaName,
          objectName: schemaName,
        },
      };
    }
    case "enum":
    case "composite_type":
    case "range": {
      const schema = requireSchema(change);
      const objectName = getObjectName(change);
      return {
        path: schemaPath(schema, "types", `${objectName}.sql`),
        category: "types",
        metadata: {
          objectType: change.objectType,
          schemaName: schema,
          objectName,
        },
      };
    }
    case "domain": {
      const schema = requireSchema(change);
      const objectName = getObjectName(change);
      return {
        path: schemaPath(schema, "domains", `${objectName}.sql`),
        category: "domains",
        metadata: {
          objectType: "domain",
          schemaName: schema,
          objectName,
        },
      };
    }
    case "collation": {
      const schema = requireSchema(change);
      const objectName = getObjectName(change);
      return {
        path: schemaPath(schema, "collations", `${objectName}.sql`),
        category: "collations",
        metadata: {
          objectType: "collation",
          schemaName: schema,
          objectName,
        },
      };
    }
    case "sequence": {
      const schema = requireSchema(change);
      const objectName = getObjectName(change);

      // ALTER SEQUENCE ... OWNED BY must be grouped with the owning table,
      // not the sequence file, to avoid ordering issues: the table must exist
      // before the OWNED BY clause can reference its column.
      if (
        change.operation === "alter" &&
        "ownedBy" in change &&
        change.ownedBy
      ) {
        const ownedBy = change.ownedBy as {
          schema: string;
          table: string;
          column: string;
        };
        return {
          path: schemaPath(ownedBy.schema, "tables", `${ownedBy.table}.sql`),
          category: "tables",
          metadata: {
            objectType: "table",
            schemaName: ownedBy.schema,
            objectName: ownedBy.table,
          },
        };
      }

      return {
        path: schemaPath(schema, "sequences", `${objectName}.sql`),
        category: "sequences",
        metadata: {
          objectType: "sequence",
          schemaName: schema,
          objectName,
        },
      };
    }
    case "table": {
      const schema = change.table.schema;
      const tableName = change.table.name;
      return {
        path: schemaPath(schema, "tables", `${tableName}.sql`),
        category: "tables",
        metadata: {
          objectType: "table",
          schemaName: schema,
          objectName: tableName,
        },
      };
    }
    case "foreign_table": {
      const schema = requireSchema(change);
      const objectName = getObjectName(change);
      return {
        path: schemaPath(schema, "foreign_tables", `${objectName}.sql`),
        category: "foreign_tables",
        metadata: {
          objectType: "foreign_table",
          schemaName: schema,
          objectName,
        },
      };
    }
    case "view": {
      const schema = requireSchema(change);
      const objectName = getObjectName(change);
      return {
        path: schemaPath(schema, "views", `${objectName}.sql`),
        category: "views",
        metadata: {
          objectType: "view",
          schemaName: schema,
          objectName,
        },
      };
    }
    case "materialized_view": {
      const schema = requireSchema(change);
      const objectName = getObjectName(change);
      return {
        path: schemaPath(schema, "matviews", `${objectName}.sql`),
        category: "matviews",
        metadata: {
          objectType: "materialized_view",
          schemaName: schema,
          objectName,
        },
      };
    }
    case "procedure": {
      const schema = requireSchema(change);
      const objectName = getObjectName(change);
      const isProcedure = change.procedure.kind === "p";
      return {
        path: schemaPath(
          schema,
          isProcedure ? "procedures" : "functions",
          `${objectName}.sql`,
        ),
        category: isProcedure ? "procedures" : "functions",
        metadata: {
          objectType: isProcedure ? "procedure" : "function",
          schemaName: schema,
          objectName,
        },
      };
    }
    case "aggregate": {
      const schema = requireSchema(change);
      const objectName = getObjectName(change);
      return {
        path: schemaPath(schema, "aggregates", `${objectName}.sql`),
        category: "aggregates",
        metadata: {
          objectType: "aggregate",
          schemaName: schema,
          objectName,
        },
      };
    }
    case "index": {
      const schema = requireSchema(change);
      const parent = getParentInfo(change);
      if (!parent) {
        throw new Error("Expected parent for index change");
      }
      const parentName = parent.name;
      const category =
        parent.type === "materialized_view" ? "matviews" : "tables";
      return {
        path: schemaPath(schema, category, `${parentName}.sql`),
        category,
        metadata: {
          objectType: parent.type,
          schemaName: schema,
          objectName: parentName,
        },
      };
    }
    case "trigger":
    case "rls_policy":
    case "rule": {
      const schema = requireSchema(change);
      const parent = getParentInfo(change);
      if (!parent || parent.type !== "table") {
        throw new Error(
          `Expected table parent for ${change.objectType} change`,
        );
      }
      const tableName = parent.name;
      return {
        path: schemaPath(schema, "tables", `${tableName}.sql`),
        category: "tables",
        metadata: {
          objectType: "table",
          schemaName: schema,
          objectName: tableName,
        },
      };
    }
    default: {
      const _exhaustive: never = change;
      return _exhaustive;
    }
  }
}

// ============================================================================
// Entity Grouping
// ============================================================================

/** A compiled grouping pattern: pre-built RegExp + group name. */
export interface CompiledPattern {
  regex: RegExp;
  name: string;
}

/**
 * Compile user-facing `GroupingPattern[]` into `CompiledPattern[]`.
 * Strings are turned into `new RegExp(str)`. Invalid regex strings are skipped
 * (no throw), so the returned array may be shorter than the input.
 */
export function compilePatterns(
  patterns: import("./types.ts").GroupingPattern[],
): CompiledPattern[] {
  const result: CompiledPattern[] = [];
  for (const p of patterns) {
    let regex: RegExp;
    if (typeof p.pattern === "string") {
      try {
        regex = new RegExp(p.pattern);
      } catch {
        continue;
      }
    } else {
      regex = p.pattern;
    }
    result.push({ regex, name: p.name });
  }
  return result;
}

/**
 * Create a file mapper that applies regex-based grouping on top of the
 * default `getFilePath` mapping.
 *
 * When no grouping config is provided (or it is undefined), the plain
 * `getFilePath` function is returned unchanged.
 */
export function createFileMapper(
  grouping?: Grouping,
): (change: Change) => FilePath {
  if (!grouping) return getFilePath;

  let compiled: CompiledPattern[];
  try {
    compiled = compilePatterns(grouping.groupPatterns ?? []);
  } catch {
    compiled = [];
  }
  const autoPartitions = grouping.autoGroupPartitions !== false; // default true
  const flatSet = new Set(grouping.flatSchemas ?? []);

  return (change: Change): FilePath => {
    const basePath = getFilePath(change);

    // Flat schemas: collapse everything into one file per category.
    // Applied first -- skips pattern matching for these schemas.
    if (
      flatSet.size > 0 &&
      basePath.metadata.schemaName &&
      flatSet.has(basePath.metadata.schemaName)
    ) {
      return flattenSchema(basePath);
    }

    const groupName = resolveGroupName(
      change,
      basePath,
      compiled,
      autoPartitions,
    );
    if (!groupName) return basePath;
    return applyGrouping(basePath, groupName, grouping.mode);
  };
}

/**
 * Flatten a schema-scoped file path into one file per category.
 *
 * e.g. `schemas/partman/tables/template_public_events.sql`
 *    → `schemas/partman/tables.sql`
 *
 * `schema.sql` is left unchanged (it is already flat).
 */
export function flattenSchema(filePath: FilePath): FilePath {
  const schema = filePath.metadata.schemaName ?? "";
  const category = filePath.category;

  // schema.sql stays as-is
  if (category === "schema") return filePath;

  return {
    path: schemaPath(schema, `${category}.sql`),
    category,
    metadata: {
      ...filePath.metadata,
      objectName: category,
    },
  };
}

/**
 * Determine the group name for a change, or `null` if it should not be
 * grouped.
 *
 * Resolution order:
 *  1. Automatic partition detection -- resolve the parent table name.
 *  2. Regex patterns -- first match wins (user controls priority by ordering).
 *
 * The resolved name from step 1 is fed through step 2 so that a partition
 * parent name can itself be matched by a broader pattern (e.g. parent
 * "kubernetes_resource_events" matches `/^kubernetes/`).
 *
 * If auto-detect resolved a parent but no pattern matched, the parent name
 * is used as-is.
 */
export function resolveGroupName(
  change: Change,
  filePath: FilePath,
  patterns: CompiledPattern[],
  autoPartitions: boolean,
): string | null {
  // Only schema-scoped objects can be grouped (skip cluster-level).
  if (!filePath.metadata.schemaName) return null;

  // 1. Auto-detect partitions: table changes where the table is a partition
  //    of another table.
  let resolvedName: string | null = null;
  if (
    autoPartitions &&
    change.objectType === "table" &&
    change.table.is_partition &&
    change.table.parent_name
  ) {
    resolvedName = change.table.parent_name;
  }

  // 2. Regex patterns -- first match wins.
  const nameToMatch = resolvedName ?? filePath.metadata.objectName;
  if (nameToMatch) {
    for (const p of patterns) {
      if (p.regex.test(nameToMatch)) {
        return p.name;
      }
    }
  }

  // 3. If auto-detect found a parent but no pattern matched, use the parent
  //    name directly.
  return resolvedName;
}

/**
 * Rewrite a `FilePath` according to the chosen grouping mode.
 *
 * - **single-file**: the filename becomes `{prefix}.sql` inside the original
 *   category directory.
 *   e.g. `schemas/public/tables/wal_verification_results_p20260107.sql`
 *     → `schemas/public/tables/wal_verification_results.sql`
 *
 * - **subdirectory**: the file is moved to a prefix-named directory under the
 *   schema root, with the category as the filename.
 *   e.g. `schemas/public/tables/wal_verification_results_p20260107.sql`
 *     → `schemas/public/wal_verification_results/tables.sql`
 */
export function applyGrouping(
  filePath: FilePath,
  prefix: string,
  mode: Grouping["mode"],
): FilePath {
  const schema = filePath.metadata.schemaName ?? "";
  const category = filePath.category as FileCategory;

  if (mode === "single-file") {
    // Replace the filename, keep the category directory.
    return {
      path: schemaPath(schema, category, `${prefix}.sql`),
      category,
      metadata: {
        ...filePath.metadata,
        objectName: prefix,
      },
    };
  }

  // subdirectory mode: schemas/{schema}/{prefix}/{category}.sql
  return {
    path: schemaPath(schema, prefix, `${category}.sql`),
    category,
    metadata: {
      ...filePath.metadata,
      objectName: prefix,
    },
  };
}
