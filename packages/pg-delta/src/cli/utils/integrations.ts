/**
 * Utilities for loading integrations from files.
 */

import { readFile } from "node:fs/promises";
import type { CatalogSnapshot } from "../../core/catalog.snapshot.ts";
import type { FilterDSL } from "../../core/integrations/filter/dsl.ts";
import type { IntegrationDSL } from "../../core/integrations/integration-dsl.ts";
import { mergeIntegrations } from "../../core/integrations/merge.ts";
import type { SerializeDSL } from "../../core/integrations/serialize/dsl.ts";

/**
 * Load a raw integration DSL from a file or core integration (without resolving extends).
 *
 * @param nameOrPath - Integration name (e.g., "supabase") or file path (e.g., "./my-integration.json")
 * @returns The loaded IntegrationDSL (unresolved)
 */
async function loadRawIntegrationDSL(
  nameOrPath: string,
): Promise<IntegrationDSL> {
  // If path ends with .json, treat it as a JSON file path directly
  if (nameOrPath.endsWith(".json")) {
    const content = await readFile(nameOrPath, "utf-8");
    return JSON.parse(content) as IntegrationDSL;
  }

  // Try loading from core integrations (TypeScript) first
  try {
    const module = await import(`../../core/integrations/${nameOrPath}.ts`);
    // Core integrations export using the integration name directly (e.g., "supabase")
    const integrationName = nameOrPath;
    if (integrationName in module) {
      return module[integrationName] as IntegrationDSL;
    }
    // If no matching export, fall through to JSON file loading
  } catch {
    // Module not found or not a core integration, fall through to JSON file loading
  }

  // Fallback to treating as JSON file path
  const content = await readFile(nameOrPath, "utf-8");
  return JSON.parse(content) as IntegrationDSL;
}

/**
 * Load a core integration DSL by name only (no file path fallback).
 *
 * Used for resolving `extends` chains, which only support core integration names
 * (e.g., "supabase"), not file paths.
 *
 * @param name - Core integration name (e.g., "supabase")
 * @returns The loaded IntegrationDSL (unresolved)
 */
async function loadCoreIntegrationDSL(name: string): Promise<IntegrationDSL> {
  try {
    const module = await import(`../../core/integrations/${name}.ts`);
    if (name in module) {
      return module[name] as IntegrationDSL;
    }
  } catch {
    // Module not found
  }
  throw new Error(
    `Unknown core integration: "${name}". extends only supports core integration names (e.g., "supabase").`,
  );
}

/**
 * Load an integration DSL, recursively resolving `extends` chains.
 *
 * When an integration has `extends`, the referenced integration(s) are loaded
 * and merged: filters are AND-combined, serialize rules concatenated (base first),
 * and emptyCatalog uses the most-specific value.
 *
 * Circular extends are detected and rejected with a descriptive error.
 *
 * @param nameOrPath - Integration name (e.g., "supabase") or file path
 * @returns The fully resolved IntegrationDSL
 */
export async function loadIntegrationDSL(
  nameOrPath: string,
): Promise<IntegrationDSL> {
  return resolveIntegration(nameOrPath, new Set());
}

async function resolveIntegration(
  nameOrPath: string,
  visited: Set<string>,
  preloadedRaw?: IntegrationDSL,
): Promise<IntegrationDSL> {
  if (visited.has(nameOrPath)) {
    throw new Error(
      `Circular extends detected: ${[...visited, nameOrPath].join(" → ")}`,
    );
  }
  visited.add(nameOrPath);

  const raw = preloadedRaw ?? (await loadRawIntegrationDSL(nameOrPath));

  if (!raw.extends) {
    return raw;
  }

  // Resolve base integrations (extends only supports core integration names)
  const extendsArray = Array.isArray(raw.extends) ? raw.extends : [raw.extends];

  const baseIntegrations: IntegrationDSL[] = [];
  for (const baseName of extendsArray) {
    const baseRaw = await loadCoreIntegrationDSL(baseName);
    baseIntegrations.push(
      await resolveIntegration(baseName, new Set(visited), baseRaw),
    );
  }

  // Remove extends from the current integration before merging
  const { extends: _, ...current } = raw;

  // Merge: bases first (higher priority serialize), then current (most-specific)
  return mergeIntegrations([...baseIntegrations, current]);
}

interface ResolvedIntegrationOptions {
  filter?: FilterDSL;
  serialize?: SerializeDSL;
  emptyCatalog?: CatalogSnapshot;
}

/**
 * Load an integration (if provided) and merge its filter/serialize with CLI flags.
 *
 * - Filters are AND-combined (integration ∧ CLI flag)
 * - Serialize rules are concatenated (integration first = higher priority)
 * - emptyCatalog is extracted from the integration
 */
export async function resolveIntegrationOptions(options: {
  filter?: FilterDSL;
  serialize?: SerializeDSL;
  integration?: string;
}): Promise<ResolvedIntegrationOptions> {
  if (!options.integration) {
    return {
      filter: options.filter,
      serialize: options.serialize,
    };
  }

  const integrationDSL = await loadIntegrationDSL(options.integration);

  // AND-combine integration filter with CLI --filter
  let filter: FilterDSL | undefined;
  if (integrationDSL.filter && options.filter) {
    filter = { and: [integrationDSL.filter, options.filter] };
  } else {
    filter = options.filter ?? integrationDSL.filter;
  }

  // Concatenate serialize rules (integration first = higher priority)
  let serialize: SerializeDSL | undefined;
  if (integrationDSL.serialize && options.serialize) {
    serialize = [...integrationDSL.serialize, ...options.serialize];
  } else {
    serialize = options.serialize ?? integrationDSL.serialize;
  }

  return {
    filter,
    serialize,
    emptyCatalog: integrationDSL.emptyCatalog,
  };
}
