/**
 * Shared utility for resolving integration DSL, filter, and serialize options.
 * Used by plan, sync, and declarative-export handlers.
 */

import { Effect, type FileSystem, Option } from "effect";
import type { CatalogSnapshot } from "../../core/catalog.snapshot.ts";
import type { FilterDSL } from "../../core/integrations/filter/dsl.ts";
import type { ChangeFilter } from "../../core/integrations/filter/filter.types.ts";
import type { SerializeDSL } from "../../core/integrations/serialize/dsl.ts";
import type { ChangeSerializer } from "../../core/integrations/serialize/serialize.types.ts";
import { CliExitError } from "../errors.ts";
import { parseJsonEffect } from "../utils.ts";
import { loadIntegrationDSL } from "./integrations.ts";

interface ResolvedIntegration {
  readonly filter: FilterDSL | ChangeFilter | undefined;
  readonly serialize: SerializeDSL | ChangeSerializer | undefined;
  readonly emptyCatalog: CatalogSnapshot | undefined;
}

export const resolveIntegration = (opts: {
  readonly filter: Option.Option<string>;
  readonly serialize: Option.Option<string>;
  readonly integration: Option.Option<string>;
}): Effect.Effect<ResolvedIntegration, CliExitError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const filterParsed: FilterDSL | undefined = Option.isSome(opts.filter)
      ? yield* parseJsonEffect<FilterDSL>("filter", opts.filter.value)
      : undefined;
    const serializeParsed: SerializeDSL | undefined = Option.isSome(
      opts.serialize,
    )
      ? yield* parseJsonEffect<SerializeDSL>("serialize", opts.serialize.value)
      : undefined;

    let filter: FilterDSL | ChangeFilter | undefined = filterParsed;
    let serialize: SerializeDSL | ChangeSerializer | undefined =
      serializeParsed;
    let emptyCatalog: CatalogSnapshot | undefined;

    if (Option.isSome(opts.integration)) {
      const integrationName = opts.integration.value;
      const integrationDSL = yield* loadIntegrationDSL(integrationName).pipe(
        Effect.mapError(
          (error) =>
            new CliExitError({
              exitCode: 1,
              message: `Error loading integration: ${error.message}`,
            }),
        ),
      );
      filter = filter ?? integrationDSL.filter;
      serialize = serialize ?? integrationDSL.serialize;
      emptyCatalog = integrationDSL.emptyCatalog;
    }

    return { filter, serialize, emptyCatalog };
  });
