import { Effect, FileSystem, Option } from "effect";
import { makeScopedDatabase } from "../../../adapters/node-pg.ts";
import {
  serializeCatalog,
  stringifyCatalogSnapshot,
} from "../../../core/catalog.snapshot.ts";
import { extractCatalog } from "../../../effect.ts";
import { CliExitError } from "../../errors.ts";
import { Output } from "../../output/output.service.ts";

export const handleCatalogExport = Effect.fnUntraced(function* (flags: {
  readonly target: string;
  readonly output: string;
  readonly role: Option.Option<string>;
}) {
  const fs = yield* FileSystem.FileSystem;
  const output = yield* Output;

  const db = yield* makeScopedDatabase(flags.target, {
    role: Option.getOrUndefined(flags.role),
    label: "target",
  }).pipe(
    Effect.mapError(
      (error) =>
        new CliExitError({
          exitCode: 1,
          message: `Error connecting to target database: ${error instanceof Error ? error.message : String(error)}`,
        }),
    ),
  );
  const catalog = yield* extractCatalog(db).pipe(
    Effect.mapError(
      (error) =>
        new CliExitError({
          exitCode: 1,
          message: `Error exporting catalog snapshot: ${error.message}`,
        }),
    ),
  );
  const snapshot = serializeCatalog(catalog);
  const json = stringifyCatalogSnapshot(snapshot);

  yield* fs.writeFileString(flags.output, json).pipe(
    Effect.mapError(
      (error) =>
        new CliExitError({
          exitCode: 1,
          message: `Error writing catalog snapshot: ${error instanceof Error ? error.message : String(error)}`,
        }),
    ),
  );
  yield* output.success(`Catalog snapshot written to ${flags.output}`);
});
