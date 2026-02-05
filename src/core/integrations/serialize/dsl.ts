/**
 * Serialization DSL - A serializable domain-specific language for customizing change serialization.
 *
 * Reuses the filter pattern matching logic to determine when to apply serialization options.
 */

import type { Change } from "../../change.types.ts";
import { evaluatePattern, type FilterPattern } from "../filter/dsl.ts";
import type { ChangeSerializer, SerializeOptions } from "./serialize.types.ts";

/**
 * A serialization rule that applies options when a pattern matches.
 */
type SerializeRule = {
  /**
   * Pattern to match against changes.
   * Uses the same pattern matching logic as filters.
   */
  when: FilterPattern;
  /**
   * Serialization options to apply when the pattern matches.
   */
  options: SerializeOptions;
};

/**
 * Serialization DSL - array of rules evaluated in order.
 * First matching rule's options are applied.
 */
export type SerializeDSL = SerializeRule[];

/**
 * Compile a Serialization DSL to a ChangeSerializer function.
 *
 * Rules are evaluated in order, and the first matching rule's options are applied.
 * If no rule matches, the change is serialized with default options.
 *
 * @param dsl - The serialization DSL
 * @returns A ChangeSerializer function that applies the rules
 *
 * @example
 * ```ts
 * const serializer = compileSerializeDSL([
 *   {
 *     when: {
 *       type: "schema",
 *       operation: "create",
 *       owner: ["service_role"]
 *     },
 *     options: { skipAuthorization: true }
 *   }
 * ]);
 * ```
 */
export function compileSerializeDSL(
  dsl: SerializeDSL,
  baseOptions?: SerializeOptions,
): ChangeSerializer {
  return (change: Change): string | undefined => {
    // Find first matching rule
    for (const rule of dsl) {
      if (evaluatePattern(rule.when, change)) {
        // Apply this rule's options
        const options = baseOptions
          ? { ...baseOptions, ...rule.options }
          : rule.options;
        return change.serialize(options);
      }
    }

    // No rule matched - use default serialization
    return change.serialize(baseOptions);
  };
}
