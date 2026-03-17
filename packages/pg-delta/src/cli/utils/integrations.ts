/**
 * Utilities for loading integrations from files.
 */

import { Effect, FileSystem } from "effect";
import type { IntegrationDSL } from "../../core/integrations/integration-dsl.ts";
import { CliExitError } from "../errors.ts";

const parseIntegrationDsl = (content: string, path: string) =>
  Effect.try({
    try: () => JSON.parse(content) as IntegrationDSL,
    catch: (error) =>
      new CliExitError({
        exitCode: 1,
        message: `Invalid integration DSL in '${path}': ${error instanceof Error ? error.message : String(error)}`,
      }),
  });

/**
 * Load an integration DSL from a file or core integration.
 * If the path ends with .json, treats it as a JSON file path directly.
 * Otherwise, tries to load from core integrations (TypeScript) first,
 * then falls back to treating as a JSON file path.
 */
export const loadIntegrationDSL = Effect.fnUntraced(function* (
  nameOrPath: string,
) {
  const fs = yield* FileSystem.FileSystem;

  if (nameOrPath.endsWith(".json")) {
    const content = yield* fs.readFileString(nameOrPath).pipe(
      Effect.mapError(
        (error) =>
          new CliExitError({
            exitCode: 1,
            message: `Cannot read integration file '${nameOrPath}': ${error.message}`,
          }),
      ),
    );
    return yield* parseIntegrationDsl(content, nameOrPath);
  }

  const module = yield* Effect.tryPromise({
    try: () =>
      import(`../../core/integrations/${nameOrPath}.ts`).catch(() => undefined),
    catch: () => undefined as never,
  }).pipe(Effect.orElseSucceed(() => undefined));
  if (module && nameOrPath in module) {
    return module[nameOrPath] as IntegrationDSL;
  }

  const content = yield* fs.readFileString(nameOrPath).pipe(
    Effect.mapError(
      (error) =>
        new CliExitError({
          exitCode: 1,
          message: `Cannot read integration file '${nameOrPath}': ${error.message}`,
        }),
    ),
  );
  return yield* parseIntegrationDsl(content, nameOrPath);
});
