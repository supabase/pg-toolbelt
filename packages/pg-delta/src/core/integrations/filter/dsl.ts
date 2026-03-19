/**
 * Filter DSL - A serializable domain-specific language for change filtering.
 *
 * Uses glob-based path matching on flattened change properties.
 * Path patterns as keys, values as matchers. Multiple keys in one object = AND.
 *
 * Path convention:
 * - Top-level change properties are bare keys: `objectType`, `operation`, `scope`, `member`, `grantee`
 * - Model sub-object properties use `<objectType>/<field>`: `table/schema`, `role/name`
 * - Wildcard `*` matches any single path segment: `* /schema` → `table/schema`, `view/schema`, etc.
 * - Separator is `/`
 *
 * Value matching:
 * - string → exact equality
 * - string[] → value must be in array (inclusion)
 * - boolean → exact equality
 * - number → exact equality
 * - { op: "regex", value: string | string[] } → regex test
 *
 * When the flat value is an array (e.g. `requires`), match succeeds if any element satisfies.
 */

import type { Change } from "../../change.types.ts";
import type { ChangeFilter } from "./filter.types.ts";
import { compileGlob, type FlatValue, flattenChange } from "./flatten.ts";

/**
 * Regex operator for advanced value matching.
 */
type RegexOperator = {
  op: "regex";
  value: string | string[];
};

/**
 * A value matcher for a path pattern key.
 */
type ValueMatcher = string | string[] | boolean | number | RegexOperator;

/**
 * Path pattern — matches against flattened change properties.
 * Keys are path patterns (with optional glob wildcards), values are matchers.
 * Multiple keys are combined with AND (all must match).
 *
 * Reserved keys: `and`, `or`, `not`, `cascade`.
 */
export type PathPattern = {
  [path: string]: ValueMatcher;
} & {
  cascade?: boolean;
  and?: never;
  or?: never;
  not?: never;
};

/**
 * Composition pattern - combines other patterns using logical operators.
 * Composition operators are exclusive - cannot be mixed with path keys.
 */
type CompositionPattern =
  | {
      and: FilterPattern[];
      cascade?: boolean;
      or?: never;
      not?: never;
    }
  | {
      or: FilterPattern[];
      cascade?: boolean;
      and?: never;
      not?: never;
    }
  | {
      not: FilterPattern;
      cascade?: boolean;
      and?: never;
      or?: never;
    };

/**
 * Filter pattern DSL.
 * Either a path pattern (matches against flattened change properties) or
 * a composition pattern (combines other patterns using logical operators).
 */
export type FilterPattern = PathPattern | CompositionPattern;

/**
 * Filter DSL - a single pattern expression.
 */
export type FilterDSL = FilterPattern;

// Reserved keys that are not path patterns
const RESERVED_KEYS = new Set(["and", "or", "not", "cascade"]);

/**
 * Match a flat value against a value matcher.
 *
 * When the flat value is an array, the match succeeds if any element satisfies.
 */
function matchValue(actual: FlatValue, expected: ValueMatcher): boolean {
  if (actual === null || actual === undefined) {
    return false;
  }

  // String matcher → exact equality
  if (typeof expected === "string") {
    if (Array.isArray(actual)) {
      return actual.some((v) => v === expected);
    }
    return actual === expected;
  }

  // Boolean matcher → exact equality
  if (typeof expected === "boolean") {
    return actual === expected;
  }

  // Number matcher → exact equality
  if (typeof expected === "number") {
    return actual === expected;
  }

  // Array matcher → inclusion (value must be in array)
  if (Array.isArray(expected)) {
    if (Array.isArray(actual)) {
      return actual.some((v) => expected.includes(v));
    }
    return typeof actual === "string" && expected.includes(actual);
  }

  // Regex operator
  if (
    typeof expected === "object" &&
    expected !== null &&
    "op" in expected &&
    expected.op === "regex"
  ) {
    const patterns = Array.isArray(expected.value)
      ? expected.value
      : [expected.value];
    if (Array.isArray(actual)) {
      return actual.some((a) =>
        patterns.some((p) => new RegExp(p).test(String(a))),
      );
    }
    return patterns.some((p) => new RegExp(p).test(String(actual)));
  }

  return false;
}

/**
 * Evaluate a pattern against a change.
 *
 * @param pattern - The pattern to evaluate
 * @param change - The change to match against
 * @returns true if the pattern matches, false otherwise
 */
export function evaluatePattern(
  pattern: FilterPattern,
  change: Change,
): boolean {
  // Handle composition operators first (they take precedence)

  // NOT operator - negate the result
  if ("not" in pattern && pattern.not) {
    return !evaluatePattern(pattern.not, change);
  }

  // AND operator - all patterns must match
  if ("and" in pattern && pattern.and) {
    return pattern.and.every((p) => evaluatePattern(p, change));
  }

  // OR operator - any pattern must match
  if ("or" in pattern && pattern.or) {
    return pattern.or.some((p) => evaluatePattern(p, change));
  }

  // Path pattern matching: flatten the change, then for each key in the pattern,
  // glob-match against flat map paths and compare values.
  const flat = flattenChange(change);

  for (const [patternKey, matcher] of Object.entries(pattern)) {
    if (RESERVED_KEYS.has(patternKey)) continue;

    const globMatcher = compileGlob(patternKey);

    // Find all flat keys that match this glob pattern
    const matchingKeys = Object.keys(flat).filter((k) => globMatcher(k));

    if (matchingKeys.length === 0) {
      // No flat keys match this glob → pattern key not satisfied
      return false;
    }

    // At least one matching key must satisfy the value matcher
    const anyMatch = matchingKeys.some((k) =>
      matchValue(flat[k], matcher as ValueMatcher),
    );
    if (!anyMatch) return false;
  }

  // All pattern keys satisfied
  return true;
}

/**
 * Compile a Filter DSL to a ChangeFilter function.
 *
 * @param dsl - The filter DSL pattern
 * @returns A ChangeFilter function that evaluates the pattern
 *
 * @example
 * ```
 * const filter = compileFilterDSL({
 *   or: [
 *     { objectType: "schema", operation: "create" },
 *     { "table/schema": "public" }
 *   ]
 * });
 * ```
 */
export function compileFilterDSL(dsl: FilterDSL): ChangeFilter {
  return (change: Change): boolean => {
    return evaluatePattern(dsl, change);
  };
}
