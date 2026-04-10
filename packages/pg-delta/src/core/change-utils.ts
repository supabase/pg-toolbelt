import type { Change } from "./change.types.ts";

/**
 * Extract the schema name from a Change using the model sub-object.
 *
 * This is a convenience function used by the filter DSL (for schema
 * normalization) and the sort module. It reads the `schema` (or `name`
 * for schema objectType) from the model sub-object.
 */
export function getSchema(change: Change): string | null {
  if (change.scope === "default_privilege") {
    return change.inSchema;
  }
  switch (change.objectType) {
    case "aggregate":
      return change.aggregate.schema;
    case "collation":
      return change.collation.schema;
    case "composite_type":
      return change.compositeType.schema;
    case "domain":
      return change.domain.schema;
    case "enum":
      return change.enum.schema;
    case "event_trigger":
      return change.eventTrigger.function_schema;
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
    case "publication":
      return null;
    case "range":
      return change.range.schema;
    case "rls_policy":
      return change.policy.schema;
    case "role":
      return null;
    case "rule":
      return change.rule.schema;
    case "schema":
      return change.schema.name;
    case "sequence":
      return change.sequence.schema;
    case "subscription":
      return null;
    case "table":
      return change.table.schema;
    case "trigger":
      return change.trigger.schema;
    case "view":
      return change.view.schema;
    case "foreign_data_wrapper":
      return null;
    case "server":
      return null;
    case "user_mapping":
      return null;
    case "foreign_table":
      return change.foreignTable.schema;
    default: {
      // exhaustiveness check
      const _exhaustive: never = change;
      return _exhaustive;
    }
  }
}
