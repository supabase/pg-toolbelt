/**
 * Integration merging — combines multiple IntegrationDSL objects.
 *
 * - Filters are AND-combined
 * - Serialize rules are concatenated (earlier integrations first = higher priority)
 * - emptyCatalog: most-specific (last) integration's value wins
 */

import type { FilterDSL } from "./filter/dsl.ts";
import type { IntegrationDSL } from "./integration-dsl.ts";
import type { SerializeDSL } from "./serialize/dsl.ts";

/**
 * Merge an ordered list of integrations into a single IntegrationDSL.
 *
 * Integrations are ordered from base (first) to most-specific (last).
 * - Filters: AND-combined (all must pass)
 * - Serialize: concatenated (base rules first → higher priority, first-match-wins)
 * - emptyCatalog: most-specific non-undefined value wins
 *
 * @param integrations - Ordered list of integrations (base first, most-specific last)
 * @returns A single merged IntegrationDSL
 */
export function mergeIntegrations(
  integrations: IntegrationDSL[],
): IntegrationDSL {
  if (integrations.length === 0) return {};
  if (integrations.length === 1) return integrations[0];

  // Collect all filters
  const filters: FilterDSL[] = [];
  for (const integration of integrations) {
    if (integration.filter) {
      filters.push(integration.filter);
    }
  }

  // Collect all serialize rules (base first = higher priority)
  const serializeRules: SerializeDSL = [];
  for (const integration of integrations) {
    if (integration.serialize) {
      serializeRules.push(...integration.serialize);
    }
  }

  // emptyCatalog: most-specific (last) non-undefined wins
  let emptyCatalog: IntegrationDSL["emptyCatalog"];
  for (let i = integrations.length - 1; i >= 0; i--) {
    if (integrations[i].emptyCatalog !== undefined) {
      emptyCatalog = integrations[i].emptyCatalog;
      break;
    }
  }

  const merged: IntegrationDSL = {};

  if (filters.length === 1) {
    merged.filter = filters[0];
  } else if (filters.length > 1) {
    merged.filter = { and: filters };
  }

  if (serializeRules.length > 0) {
    merged.serialize = serializeRules;
  }

  if (emptyCatalog !== undefined) {
    merged.emptyCatalog = emptyCatalog;
  }

  return merged;
}
