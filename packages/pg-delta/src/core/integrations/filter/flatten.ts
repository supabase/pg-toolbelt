/**
 * Change flattening and glob path matching for the filter DSL.
 *
 * Each Change is flattened into a Record<string, FlatValue> where top-level
 * scalar properties become bare keys and model sub-object properties become
 * `<objectType>/<field>` paths. Glob patterns (e.g. `* /schema`) match
 * against these flat paths.
 */

import type { Change } from "../../change.types.ts";
import { OBJECT_TYPE_TO_PROPERTY_KEY } from "../../change.types.ts";

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
