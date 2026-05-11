import { compileFilterDSL, type FilterDSL } from "./filter/dsl.ts";
import type { ChangeFilter } from "./filter/filter.types.ts";
import { compileSerializeDSL, type SerializeDSL } from "./serialize/dsl.ts";
import type { ChangeSerializer } from "./serialize/serialize.types.ts";

/**
 * A resolved integration is an integration that has been compiled to a function.
 */
export type ResolvedIntegration = {
  filter?: ChangeFilter;
  serialize?: ChangeSerializer;
};

/**
 * A raw integration is an integration that has not been compiled to a function.
 */
export type IntegrationDSL = {
  filter?: FilterDSL;
  serialize?: SerializeDSL;
};

/**
 * An integration is a raw integration that has not been compiled to a function.
 */
export type Integration = {
  filter?: ResolvedIntegration["filter"] | IntegrationDSL["filter"];
  serialize?: ResolvedIntegration["serialize"] | IntegrationDSL["serialize"];
};

/**
 * Resolve an integration either DSL or already resovled into a ResolvedIntegration.
 * @param integration - The integration to resolve.
 * @returns The resolved integration.
 */
export function resolveIntegration(
  integration: Integration,
): ResolvedIntegration | undefined {
  // Determine if filter/serialize are DSL or functions, and extract DSL for storage
  const isFilterDSL =
    integration.filter && typeof integration.filter !== "function";
  const isSerializeDSL =
    integration.serialize && typeof integration.serialize !== "function";
  const filterDSL = isFilterDSL ? (integration.filter as FilterDSL) : undefined;
  const serializeDSL = isSerializeDSL
    ? (integration.serialize as SerializeDSL)
    : undefined;

  // Build final integration: compile DSL if needed, use functions directly otherwise
  if (integration.filter || integration.serialize) {
    return {
      filter:
        typeof integration.filter === "function"
          ? integration.filter
          : filterDSL
            ? compileFilterDSL(filterDSL)
            : undefined,
      serialize:
        typeof integration.serialize === "function"
          ? integration.serialize
          : serializeDSL
            ? compileSerializeDSL(serializeDSL)
            : undefined,
    };
  }
}
