import type { Catalog } from "../../src/catalog.model.ts";
import type { Change } from "../../src/change.types.ts";

const SUPABASE_SCHEMAS = [
  "auth",
  "cron",
  "pgmq",
  "pgmq_public",
  "pgsodium",
  "realtime",
  "storage",
  "vault",
];

function getSchema(change: Change) {
  switch (change.objectType) {
    case "collation":
      return change.collation.schema;
    case "composite_type":
      return change.compositeType.schema;
    case "domain":
      return change.domain.schema;
    case "enum":
      return change.enum.schema;
    case "extension":
      return change.extension.schema;
    case "index":
      return change.index.schema;
    case "language":
      return null;
    case "materialized_view":
      return change.materializedView.schema;
    case "procedure":
      return change.procedure.schema;
    case "range":
      return change.range.schema;
    case "rls_policy":
      return change.policy.schema;
    case "role":
      return null;
    case "schema":
      return change.schema.name;
    case "sequence":
      return change.sequence.schema;
    case "table":
      return change.table.schema;
    case "trigger":
      return change.trigger.schema;
    case "view":
      return change.view.schema;
    default: {
      // exhaustiveness check
      const _exhaustive: never = change;
      return _exhaustive;
    }
  }
}

export function supabaseFilter(
  _ctx: { mainCatalog: Catalog; branchCatalog: Catalog },
  changes: Change[],
) {
  return changes.filter((change) => {
    const schema = getSchema(change);
    return (
      change.objectType === "extension" ||
      change.objectType === "schema" ||
      schema === null ||
      !SUPABASE_SCHEMAS.includes(schema)
    );
  });
}
