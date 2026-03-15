/**
 * Shared utilities for resolving CLI --source/--target inputs that
 * can be either a PostgreSQL connection URL or a catalog snapshot file path.
 */

import { Effect, FileSystem, Option } from "effect";
import type { Catalog } from "../../core/catalog.model.ts";
import type { CatalogSnapshot } from "../../core/catalog.snapshot.ts";
import { CliExitError } from "../errors.ts";
import { deserializeCatalogSnapshotEffect } from "../utils.ts";

export function isPostgresUrl(input: string): boolean {
  return input.startsWith("postgres://") || input.startsWith("postgresql://");
}

export const loadCatalogFromFile = (
  path: string,
): Effect.Effect<Catalog, CliExitError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const json = yield* fs.readFileString(path).pipe(
      Effect.mapError(
        (error) =>
          new CliExitError({
            exitCode: 1,
            message: `Error loading catalog file '${path}': ${error.message}`,
          }),
      ),
    );

    const snapshot = yield* Effect.try({
      try: () => JSON.parse(json) as CatalogSnapshot,
      catch: (error) =>
        new CliExitError({
          exitCode: 1,
          message: `Error parsing catalog file '${path}': ${error instanceof Error ? error.message : String(error)}`,
        }),
    });

    return yield* deserializeCatalogSnapshotEffect(snapshot);
  });

export const resolveSourceInput = (
  source: Option.Option<string>,
  integrationEmptyCatalog: CatalogSnapshot | undefined,
): Effect.Effect<
  string | Catalog | null,
  CliExitError,
  FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    if (Option.isSome(source)) {
      return isPostgresUrl(source.value)
        ? source.value
        : yield* loadCatalogFromFile(source.value);
    }
    if (integrationEmptyCatalog) {
      return yield* deserializeCatalogSnapshotEffect(integrationEmptyCatalog);
    }
    return null;
  });

export const resolveTargetInput = (
  target: string,
): Effect.Effect<string | Catalog, CliExitError, FileSystem.FileSystem> =>
  isPostgresUrl(target) ? Effect.succeed(target) : loadCatalogFromFile(target);
