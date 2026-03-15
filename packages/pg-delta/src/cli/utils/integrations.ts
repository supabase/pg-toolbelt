/**
 * Utilities for loading integrations from files.
 */

import { Effect, FileSystem } from "effect";
import type { IntegrationDSL } from "../../core/integrations/integration-dsl.ts";

const parseIntegrationDsl = (
  content: string,
  path: string,
): Effect.Effect<IntegrationDSL, Error> =>
  Effect.try({
    try: () => JSON.parse(content) as IntegrationDSL,
    catch: (error) =>
      new Error(
        `Invalid integration DSL in '${path}': ${error instanceof Error ? error.message : String(error)}`,
      ),
  });

/**
 * Load an integration DSL from a file or core integration.
 * If the path ends with .json, treats it as a JSON file path directly.
 * Otherwise, tries to load from core integrations (TypeScript) first,
 * then falls back to treating as a JSON file path.
 */
export const loadIntegrationDSL = (
  nameOrPath: string,
): Effect.Effect<IntegrationDSL, Error, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    if (nameOrPath.endsWith(".json")) {
      const content = yield* fs.readFileString(nameOrPath).pipe(
        Effect.mapError(
          (error) =>
            new Error(
              `Cannot read integration file '${nameOrPath}': ${error.message}`,
            ),
        ),
      );
      return yield* parseIntegrationDsl(content, nameOrPath);
    }

    const module = yield* Effect.promise(() =>
      import(`../../core/integrations/${nameOrPath}.ts`).catch(() => undefined),
    );
    if (module && nameOrPath in module) {
      return module[nameOrPath] as IntegrationDSL;
    }

    const content = yield* fs.readFileString(nameOrPath).pipe(
      Effect.mapError(
        (error) =>
          new Error(
            `Cannot read integration file '${nameOrPath}': ${error.message}`,
          ),
      ),
    );
    return yield* parseIntegrationDsl(content, nameOrPath);
  });
