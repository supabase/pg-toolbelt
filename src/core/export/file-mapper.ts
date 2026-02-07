/**
 * Map changes to declarative schema file paths.
 */

import type { Change } from "../change.types.ts";
import type { TableConstraintProps } from "../objects/table/table.model.ts";
import {
  getObjectName,
  getObjectSchema,
  getParentInfo,
} from "../plan/serialize.ts";
import type { FilePath } from "./types.ts";

// ============================================================================
// Helpers
// ============================================================================

type ConstraintChange = Change & {
  constraint: TableConstraintProps;
  table: { schema: string; name: string };
};

function isConstraintChange(change: Change): change is ConstraintChange {
  return change.objectType === "table" && "constraint" in change;
}

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

function isForeignKeyConstraintChange(change: Change): boolean {
  return (
    isConstraintChange(change) && change.constraint.constraint_type === "f"
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
      if (isForeignKeyConstraintChange(change)) {
        // FK constraints reference other tables, so they must be separated
        // from triggers/RLS policies to avoid ordering issues.
        return {
          path: schemaPath(schema, "foreign_keys", `${tableName}.sql`),
          category: "foreign_keys",
          metadata: {
            objectType: "foreign_key",
            schemaName: schema,
            objectName: tableName,
          },
        };
      }
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
      const objectName = getObjectName(change);
      return {
        path: schemaPath(schema, "indexes", `${objectName}.sql`),
        category: "indexes",
        metadata: {
          objectType: "index",
          schemaName: schema,
          objectName,
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
        path: schemaPath(schema, "policies", `${tableName}.sql`),
        category: "policies",
        metadata: {
          objectType: "policy",
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
