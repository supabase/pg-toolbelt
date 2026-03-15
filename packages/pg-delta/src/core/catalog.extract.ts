import { Effect } from "effect";
import { normalizeCatalog } from "./catalog.normalize.ts";
import { Catalog } from "./catalog.ts";
import { extractCurrentUser, extractVersion } from "./context.ts";
import { extractDepends } from "./depend.ts";
import type { CatalogExtractionError } from "./errors.ts";
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

export const extractCatalog = (
  db: DatabaseApi,
): Effect.Effect<Catalog, CatalogExtractionError> =>
  Effect.gen(function* () {
    const results = yield* Effect.all(
      {
        aggregates: extractAggregates(db).pipe(Effect.map(listToRecord)),
        collations: extractCollations(db).pipe(Effect.map(listToRecord)),
        compositeTypes: extractCompositeTypes(db).pipe(
          Effect.map(listToRecord),
        ),
        domains: extractDomains(db).pipe(Effect.map(listToRecord)),
        enums: extractEnums(db).pipe(Effect.map(listToRecord)),
        extensions: extractExtensions(db).pipe(Effect.map(listToRecord)),
        indexes: extractIndexes(db).pipe(Effect.map(listToRecord)),
        materializedViews: extractMaterializedViews(db).pipe(
          Effect.map(listToRecord),
        ),
        subscriptions: extractSubscriptions(db).pipe(Effect.map(listToRecord)),
        publications: extractPublications(db).pipe(Effect.map(listToRecord)),
        procedures: extractProcedures(db).pipe(Effect.map(listToRecord)),
        rlsPolicies: extractRlsPolicies(db).pipe(Effect.map(listToRecord)),
        roles: extractRoles(db).pipe(Effect.map(listToRecord)),
        schemas: extractSchemas(db).pipe(Effect.map(listToRecord)),
        sequences: extractSequences(db).pipe(Effect.map(listToRecord)),
        tables: extractTables(db).pipe(Effect.map(listToRecord)),
        triggers: extractTriggers(db).pipe(Effect.map(listToRecord)),
        eventTriggers: extractEventTriggers(db).pipe(Effect.map(listToRecord)),
        rules: extractRules(db).pipe(Effect.map(listToRecord)),
        ranges: extractRanges(db).pipe(Effect.map(listToRecord)),
        views: extractViews(db).pipe(Effect.map(listToRecord)),
        foreignDataWrappers: extractForeignDataWrappers(db).pipe(
          Effect.map(listToRecord),
        ),
        servers: extractServers(db).pipe(Effect.map(listToRecord)),
        userMappings: extractUserMappings(db).pipe(Effect.map(listToRecord)),
        foreignTables: extractForeignTables(db).pipe(Effect.map(listToRecord)),
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
