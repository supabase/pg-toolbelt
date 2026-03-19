/**
 * Utilities for loading integrations from files.
 */

import { readFile } from "node:fs/promises";
import type { IntegrationDSL } from "../../core/integrations/integration-dsl.ts";
import { mergeIntegrations } from "../../core/integrations/merge.ts";

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
): Promise<IntegrationDSL> {
  if (visited.has(nameOrPath)) {
    throw new Error(
      `Circular extends detected: ${[...visited, nameOrPath].join(" → ")}`,
    );
  }
  visited.add(nameOrPath);

  const raw = await loadRawIntegrationDSL(nameOrPath);

  if (!raw.extends) {
    return raw;
  }

  // Resolve base integrations
  const extendsArray = Array.isArray(raw.extends) ? raw.extends : [raw.extends];

  const baseIntegrations: IntegrationDSL[] = [];
  for (const baseName of extendsArray) {
    baseIntegrations.push(await resolveIntegration(baseName, new Set(visited)));
  }

  // Remove extends from the current integration before merging
  const { extends: _, ...current } = raw;

  // Merge: bases first (higher priority serialize), then current (most-specific)
  return mergeIntegrations([...baseIntegrations, current]);
}
