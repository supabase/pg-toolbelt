/**
 * Change flattening and glob path matching for the filter DSL.
 *
 * Each Change is flattened into a Record<string, FlatValue> where top-level
 * scalar properties become bare keys and model sub-object properties become
 * `<objectType>/<field>` paths. Glob patterns (e.g. `* /schema`) match
 * against these flat paths.
 */

import type { Change } from "../../change.types.ts";

/**
 * A flat value extracted from a Change: scalar types or string arrays.
 */
export type FlatValue = string | number | boolean | null | string[];

/**
 * Maps objectType values to the JS property key on the Change object
 * that holds the model sub-object.
 */
export const OBJECT_TYPE_TO_PROPERTY_KEY: Record<string, string> = {
  aggregate: "aggregate",
  collation: "collation",
  composite_type: "compositeType",
  domain: "domain",
  enum: "enum",
  event_trigger: "eventTrigger",
  extension: "extension",
  foreign_data_wrapper: "foreignDataWrapper",
  foreign_table: "foreignTable",
  index: "index",
  language: "language",
  materialized_view: "materializedView",
  procedure: "procedure",
  publication: "publication",
  range: "range",
  rls_policy: "policy",
  role: "role",
  rule: "rule",
  schema: "schema",
  sequence: "sequence",
  server: "server",
  subscription: "subscription",
  table: "table",
  trigger: "trigger",
  user_mapping: "userMapping",
  view: "view",
};

/**
 * WeakMap cache to avoid re-flattening the same Change instance.
 */
const flattenCache = new WeakMap<Change, Record<string, FlatValue>>();

/**
 * Flatten a Change into a Record<string, FlatValue>.
 *
 * - Top-level scalars (objectType, operation, scope) → bare keys
 * - Top-level string properties (member, grantee) → bare keys if present
 * - Array-of-string properties (requires, creates, drops) → bare keys
 * - Model sub-object scalar properties → `<objectType>/<field>`
 * - Nested objects/arrays of non-strings → skipped
 */
export function flattenChange(change: Change): Record<string, FlatValue> {
  const cached = flattenCache.get(change);
  if (cached) return cached;

  const flat: Record<string, FlatValue> = {};

  // Top-level scalar properties
  flat.objectType = change.objectType;
  flat.operation = change.operation;
  flat.scope = change.scope;

  // Array-of-string properties
  flat.requires = change.requires ?? [];
  flat.creates = change.creates ?? [];
  flat.drops = change.drops ?? [];

  // Additional top-level properties that some changes have
  if ("member" in change && typeof change.member === "string") {
    flat.member = change.member;
  }
  if ("grantee" in change && typeof change.grantee === "string") {
    flat.grantee = change.grantee;
  }

  // Model sub-object properties
  const propertyKey = OBJECT_TYPE_TO_PROPERTY_KEY[change.objectType];
  if (propertyKey) {
    const model = (change as unknown as Record<string, unknown>)[propertyKey];
    if (model && typeof model === "object" && !Array.isArray(model)) {
      const prefix = change.objectType;
      for (const [key, value] of Object.entries(
        model as Record<string, unknown>,
      )) {
        if (value === null || value === undefined) {
          flat[`${prefix}/${key}`] = null;
        } else if (
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"
        ) {
          flat[`${prefix}/${key}`] = value;
        } else if (
          Array.isArray(value) &&
          value.every((v) => typeof v === "string")
        ) {
          flat[`${prefix}/${key}`] = value as string[];
        }
        // Skip nested objects/arrays of non-strings
      }
    }
  }

  flattenCache.set(change, flat);
  return flat;
}

/**
 * Compile a glob pattern string into a matcher function.
 *
 * Supports `*` as a single-segment wildcard:
 * - `objectType` matches only `objectType`
 * - `table/schema` matches only `table/schema`
 * - `* /schema` matches `table/schema`, `view/schema`, etc.
 */
export function compileGlob(pattern: string): (path: string) => boolean {
  const patternParts = pattern.split("/");
  return (path: string): boolean => {
    const pathParts = path.split("/");
    if (patternParts.length !== pathParts.length) return false;
    return patternParts.every((pp, i) => pp === "*" || pp === pathParts[i]);
  };
}

/**
 * Extract the schema name from a Change using the model sub-object.
 *
 * This is a convenience function used by the sort module. It reads the
 * `schema` (or `name` for schema objectType) from the model sub-object.
 */
export function getSchema(change: Change): string | null {
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
      return null;
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
