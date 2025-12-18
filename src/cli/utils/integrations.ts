/**
 * Utilities for loading integrations from files.
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { IntegrationDSL } from "../../core/integrations/integration-dsl.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load an integration DSL from a JSON file.
 * First tries to load from core/integrations/ relative to the CLI,
 * then falls back to treating the path as a file system path.
 *
 * @param nameOrPath - Integration name (e.g., "supabase") or file path
 * @returns The loaded IntegrationDSL
 */
export async function loadIntegrationDSL(
  nameOrPath: string,
): Promise<IntegrationDSL> {
  // Try loading from core/integrations/ first
  // __dirname is src/cli/utils, so we go up to src/ then into core/integrations
  const coreIntegrationsPath = join(
    __dirname,
    "../../core/integrations",
    `${nameOrPath}.json`,
  );

  try {
    const content = await readFile(coreIntegrationsPath, "utf-8");
    return JSON.parse(content) as IntegrationDSL;
  } catch {
    // Fallback to treating as file path
    const content = await readFile(nameOrPath, "utf-8");
    return JSON.parse(content) as IntegrationDSL;
  }
}
