import { Effect } from "effect";
import { normalizeCatalog } from "./catalog.normalize.ts";
import { Catalog } from "./catalog.ts";
import { extractCurrentUser, extractVersion } from "./context.ts";
import { extractDepends } from "./depend.ts";
import { CatalogExtractionError } from "./errors.ts";
import { extractAggregates } from "./objects/aggregate/aggregate.model.ts";
import type { BasePgModel, TableLikeObject } from "./objects/base.model.ts";
import { extractCollations } from "./objects/collation/collation.model.ts";
import { extractDomains } from "./objects/domain/domain.model.ts";
import { extractEventTriggers } from "./objects/event-trigger/event-trigger.model.ts";
import { extractExtensions } from "./objects/extension/extension.model.ts";
import { extractForeignDataWrappers } from "./objects/foreign-data-wrapper/foreign-data-wrapper/foreign-data-wrapper.model.ts";
import { extractForeignTables } from "./objects/foreign-data-wrapper/foreign-table/foreign-table.model.ts";
import { extractServers } from "./objects/foreign-data-wrapper/server/server.model.ts";
import { extractUserMappings } from "./objects/foreign-data-wrapper/user-mapping/user-mapping.model.ts";
import { extractIndexes } from "./objects/index/index.model.ts";
import { extractMaterializedViews } from "./objects/materialized-view/materialized-view.model.ts";
import { extractProcedures } from "./objects/procedure/procedure.model.ts";
import { extractPublications } from "./objects/publication/publication.model.ts";
import { extractRlsPolicies } from "./objects/rls-policy/rls-policy.model.ts";
import { extractRoles } from "./objects/role/role.model.ts";
import { extractRules } from "./objects/rule/rule.model.ts";
import { extractSchemas } from "./objects/schema/schema.model.ts";
import { extractSequences } from "./objects/sequence/sequence.model.ts";
import { extractSubscriptions } from "./objects/subscription/subscription.model.ts";
import { extractTables } from "./objects/table/table.model.ts";
import { extractTriggers } from "./objects/trigger/trigger.model.ts";
import { extractCompositeTypes } from "./objects/type/composite-type/composite-type.model.ts";
import { extractEnums } from "./objects/type/enum/enum.model.ts";
import { extractRanges } from "./objects/type/range/range.model.ts";
import { extractViews } from "./objects/view/view.model.ts";
import type { DatabaseApi } from "./services/database.ts";

const labeled = <A>(label: string, effect: Effect.Effect<A, CatalogExtractionError>) =>
  effect.pipe(
    Effect.mapError((e) =>
      e.extractor
        ? e
        : new CatalogExtractionError({
            message: e.message,
            cause: e.cause,
            extractor: label,
          }),
    ),
  );

export const extractCatalog = (
  db: DatabaseApi,
): Effect.Effect<Catalog, CatalogExtractionError> =>
  Effect.gen(function* () {
    const results = yield* Effect.all(
      {
        aggregates: labeled("aggregates", extractAggregates(db).pipe(Effect.map(listToRecord))),
        collations: labeled("collations", extractCollations(db).pipe(Effect.map(listToRecord))),
        compositeTypes: labeled("compositeTypes", extractCompositeTypes(db).pipe(
          Effect.map(listToRecord),
        )),
        domains: labeled("domains", extractDomains(db).pipe(Effect.map(listToRecord))),
        enums: labeled("enums", extractEnums(db).pipe(Effect.map(listToRecord))),
        extensions: labeled("extensions", extractExtensions(db).pipe(Effect.map(listToRecord))),
        indexes: labeled("indexes", extractIndexes(db).pipe(Effect.map(listToRecord))),
        materializedViews: labeled("materializedViews", extractMaterializedViews(db).pipe(
          Effect.map(listToRecord),
        )),
        subscriptions: labeled("subscriptions", extractSubscriptions(db).pipe(Effect.map(listToRecord))),
        publications: labeled("publications", extractPublications(db).pipe(Effect.map(listToRecord))),
        procedures: labeled("procedures", extractProcedures(db).pipe(Effect.map(listToRecord))),
        rlsPolicies: labeled("rlsPolicies", extractRlsPolicies(db).pipe(Effect.map(listToRecord))),
        roles: labeled("roles", extractRoles(db).pipe(Effect.map(listToRecord))),
        schemas: labeled("schemas", extractSchemas(db).pipe(Effect.map(listToRecord))),
        sequences: labeled("sequences", extractSequences(db).pipe(Effect.map(listToRecord))),
        tables: labeled("tables", extractTables(db).pipe(Effect.map(listToRecord))),
        triggers: labeled("triggers", extractTriggers(db).pipe(Effect.map(listToRecord))),
        eventTriggers: labeled("eventTriggers", extractEventTriggers(db).pipe(Effect.map(listToRecord))),
        rules: labeled("rules", extractRules(db).pipe(Effect.map(listToRecord))),
        ranges: labeled("ranges", extractRanges(db).pipe(Effect.map(listToRecord))),
        views: labeled("views", extractViews(db).pipe(Effect.map(listToRecord))),
        foreignDataWrappers: labeled("foreignDataWrappers", extractForeignDataWrappers(db).pipe(
          Effect.map(listToRecord),
        )),
        servers: labeled("servers", extractServers(db).pipe(Effect.map(listToRecord))),
        userMappings: labeled("userMappings", extractUserMappings(db).pipe(Effect.map(listToRecord))),
        foreignTables: labeled("foreignTables", extractForeignTables(db).pipe(Effect.map(listToRecord))),
        depends: extractDepends(db),
        version: extractVersion(db),
        currentUser: extractCurrentUser(db),
      },
      { concurrency: "unbounded" },
    );

    const indexableObjects: Record<string, TableLikeObject> = {
      ...results.tables,
      ...results.materializedViews,
    };

    const catalog = new Catalog({
      ...results,
      indexableObjects,
    });

    return normalizeCatalog(catalog);
  });

function listToRecord<T extends BasePgModel>(list: T[]) {
  return Object.fromEntries(list.map((item) => [item.stableId, item]));
}
