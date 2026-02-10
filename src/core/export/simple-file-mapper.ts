/**
 * Map changes to flat, category-based declarative schema file paths.
 *
 * Unlike the detailed mapper (file-mapper.ts) which creates one file per object
 * in a nested directory structure, this mapper groups all objects of the same
 * category into a single flat file (e.g., all tables in "tables.sql").
 */

import type { Change } from "../change.types.ts";
import type { TableConstraintProps } from "../objects/table/table.model.ts";
import type { FilePath } from "./types.ts";

// ============================================================================
// Helpers (shared logic with file-mapper.ts)
// ============================================================================

type ConstraintChange = Change & {
  constraint: TableConstraintProps;
  table: { schema: string; name: string };
};

function isConstraintChange(change: Change): change is ConstraintChange {
  return change.objectType === "table" && "constraint" in change;
}

function isForeignKeyConstraintChange(change: Change): boolean {
  return (
    isConstraintChange(change) && change.constraint.constraint_type === "f"
  );
}

type RoleDefaultPrivilegeChange = Change & {
  objectType: "role";
  scope: "default_privilege";
  inSchema: string | null;
};

function isSchemaDefaultPrivilegeChange(
  change: Change,
): change is RoleDefaultPrivilegeChange {
  return (
    change.objectType === "role" &&
    change.scope === "default_privilege" &&
    "inSchema" in change &&
    (change as RoleDefaultPrivilegeChange).inSchema !== null
  );
}

// ============================================================================
// Simple File Path Mapping
// ============================================================================

// Path constants for the combined tables/functions file.
// Tables and functions have circular dependencies (table defaults reference
// functions, function signatures reference table types), so they must be in
// the same file where topological sort can interleave them correctly.
const TABLES_AND_FUNCTIONS_FILE = "tables_and_functions.sql";
const TABLES_AND_FUNCTIONS: FilePath = {
  path: TABLES_AND_FUNCTIONS_FILE,
  category: "tables",
  metadata: { objectType: "table" },
};

/**
 * Map a change to a flat, category-based file path.
 *
 * Produces paths like "schemas.sql", "tables_and_functions.sql", "indexes.sql"
 * instead of nested per-object paths. All objects of the same category end up
 * in the same file, with topological ordering preserved within the file.
 *
 * Tables, views, and functions are combined into a single file because they
 * have circular dependencies that can only be resolved by interleaving
 * (e.g., table defaults reference functions, function signatures reference
 * table types). The topological sort within the file handles this correctly.
 */
export function getSimpleFilePath(change: Change): FilePath {
  switch (change.objectType) {
    case "role":
      // Schema-scoped default privileges (ALTER DEFAULT PRIVILEGES ... IN SCHEMA x)
      // must go to schemas.sql so they execute after the schema is created.
      if (isSchemaDefaultPrivilegeChange(change)) {
        return {
          path: "schemas.sql",
          category: "schema",
          metadata: { objectType: "default_privilege" },
        };
      }
      return {
        path: "roles.sql",
        category: "cluster",
        metadata: { objectType: "role" },
      };
    case "extension":
      return {
        path: "extensions.sql",
        category: "extensions",
        metadata: { objectType: "extension" },
      };
    case "foreign_data_wrapper":
    case "server":
    case "user_mapping":
      return {
        path: "foreign_data_wrappers.sql",
        category: "cluster",
        metadata: { objectType: change.objectType },
      };
    case "publication":
      return {
        path: "publications.sql",
        category: "publications",
        metadata: { objectType: "publication" },
      };
    case "subscription":
      return {
        path: "subscriptions.sql",
        category: "subscriptions",
        metadata: { objectType: "subscription" },
      };
    case "event_trigger":
      return {
        path: "event_triggers.sql",
        category: "event_triggers",
        metadata: { objectType: "event_trigger" },
      };
    case "language":
      return {
        path: "languages.sql",
        category: "cluster",
        metadata: { objectType: "language" },
      };
    case "schema":
      return {
        path: "schemas.sql",
        category: "schema",
        metadata: { objectType: "schema" },
      };
    case "enum":
    case "composite_type":
    case "range":
      return {
        path: "types.sql",
        category: "types",
        metadata: { objectType: change.objectType },
      };
    case "domain":
      return {
        path: "types.sql",
        category: "types",
        metadata: { objectType: "domain" },
      };
    case "collation":
      return {
        path: "collations.sql",
        category: "collations",
        metadata: { objectType: "collation" },
      };
    case "sequence":
      // Sequences with OWNED BY go to the combined file (table must exist first).
      if (
        change.operation === "alter" &&
        "ownedBy" in change &&
        change.ownedBy
      ) {
        return TABLES_AND_FUNCTIONS;
      }
      return {
        path: "sequences.sql",
        category: "sequences",
        metadata: { objectType: "sequence" },
      };
    case "table":
      if (isForeignKeyConstraintChange(change)) {
        return {
          path: "foreign_keys.sql",
          category: "foreign_keys",
          metadata: { objectType: "foreign_key" },
        };
      }
      return TABLES_AND_FUNCTIONS;
    case "foreign_table":
      return {
        path: "foreign_tables.sql",
        category: "foreign_tables",
        metadata: { objectType: "foreign_table" },
      };
    case "view":
      return TABLES_AND_FUNCTIONS;
    case "materialized_view":
      return TABLES_AND_FUNCTIONS;
    case "procedure":
      return TABLES_AND_FUNCTIONS;
    case "aggregate":
      return TABLES_AND_FUNCTIONS;
    case "index":
      return {
        path: "indexes.sql",
        category: "indexes",
        metadata: { objectType: "index" },
      };
    case "trigger":
      return {
        path: "triggers.sql",
        category: "policies",
        metadata: { objectType: "trigger" },
      };
    case "rls_policy":
      return {
        path: "policies.sql",
        category: "policies",
        metadata: { objectType: "rls_policy" },
      };
    case "rule":
      return {
        path: "policies.sql",
        category: "policies",
        metadata: { objectType: "rule" },
      };
    default: {
      const _exhaustive: never = change;
      return _exhaustive;
    }
  }
}
