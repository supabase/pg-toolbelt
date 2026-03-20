/**
 * Change flattening and wildcard path matching for the filter DSL.
 *
 * Each Change is flattened into a Record<string, FlatValue> where top-level
 * scalar properties become bare keys and model sub-object properties become
 * `<objectType>/<field>` paths. Wildcard patterns (e.g. `* /schema`) match
 * against these flat paths.
 */

import type { Change } from "../../change.types.ts";
import { OBJECT_TYPE_TO_PROPERTY_KEY } from "../../change.types.ts";
import { getSchema } from "../../change-utils.ts";

/**
 * A flat value extracted from a Change: scalar types or string arrays.
 */
export type FlatValue =
  | string
  | number
  | boolean
  | null
  | Array<string | number>;

/**
 * WeakMap cache to avoid re-flattening the same Change instance.
 */
const flattenCache = new WeakMap<Change, Record<string, FlatValue>>();

/**
 * Convert an unknown value to a FlatValue if it's a supported type.
 *
 * Supported types (kept in the flat record):
 *   - null / undefined  → null   (missing or explicitly null)
 *   - string, number, boolean    → as-is
 *   - Array where every element is string or number → as-is
 *
 * Anything else (nested objects, arrays of objects, functions, …) is NOT
 * representable as a flat value, so we return `undefined` to signal
 * "skip this entry".
 */
function toFlatValue(value: unknown): FlatValue | undefined {
  if (value === null || value === undefined) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  if (
    Array.isArray(value) &&
    value.every((v: unknown) => typeof v === "string" || typeof v === "number")
  ) {
    return value as Array<string | number>;
  }
  return undefined;
}

/**
 * Flatten a Change into a Record<string, FlatValue>.
 *
 * A Change object has two kinds of properties:
 *
 *   1. **Top-level properties** — scalars and arrays directly on the object.
 *      These become bare keys in the flat record.
 *
 *   2. **Model sub-object** — a single nested object whose JS property name is
 *      given by OBJECT_TYPE_TO_PROPERTY_KEY. Its scalar fields are flattened
 *      with an `<objectType>/` prefix.
 *
 * After the main loop, a schema normalization step ensures that
 * `<objectType>/schema` exists for every change that logically belongs to
 * a schema — even when the model stores the schema under a different name.
 *
 * Results are cached per Change instance (WeakMap) so repeated calls are free.
 */
export function flattenChange(change: Change): Record<string, FlatValue> {
  const cached = flattenCache.get(change);
  if (cached) return cached;

  const flat: Record<string, FlatValue> = {};

  const modelKey = OBJECT_TYPE_TO_PROPERTY_KEY[change.objectType];
  const prefix = change.objectType;

  for (const [key, value] of Object.entries(change)) {
    if (
      key === modelKey &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      for (const [subKey, subValue] of Object.entries(
        value as Record<string, unknown>,
      )) {
        const flatVal = toFlatValue(subValue);
        if (flatVal !== undefined) {
          flat[`${prefix}/${subKey}`] = flatVal;
        }
      }
    } else {
      const flatVal = toFlatValue(value);
      if (flatVal !== undefined) {
        flat[key] = flatVal;
      }
    }
  }

  // requires/creates/drops are prototype getters (not own properties),
  // so Object.entries() above won't see them. Access them explicitly.
  flat.requires = change.requires ?? [];
  flat.creates = change.creates ?? [];
  flat.drops = change.drops ?? [];

  // Schema normalization: ensure <objectType>/schema exists for all changes
  // that have a schema. Handles: schema objects (name→schema), event triggers
  // (function_schema→schema), default_privilege scope (inSchema→schema).
  const schemaKey = `${prefix}/schema`;
  if (!(schemaKey in flat)) {
    const schemaValue = getSchema(change);
    if (schemaValue !== null) {
      flat[schemaKey] = schemaValue;
    }
  }

  flattenCache.set(change, flat);
  return flat;
}

/**
 * Compile a wildcard pattern string into a matcher function.
 *
 * Supports `*` as a single-segment wildcard:
 * - `objectType` matches only `objectType`
 * - `table/schema` matches only `table/schema`
 * - `* /schema` matches `table/schema`, `view/schema`, etc.
 */
export function compileWildcard(pattern: string): (path: string) => boolean {
  const patternParts = pattern.split("/");
  return (path: string): boolean => {
    const pathParts = path.split("/");
    if (patternParts.length !== pathParts.length) return false;
    return patternParts.every((pp, i) => pp === "*" || pp === pathParts[i]);
  };
}
