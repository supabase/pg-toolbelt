/**
 * Prune a catalog to the objects that match a Filter DSL expression.
 *
 * The Filter DSL is defined over Change objects, so the catalog is
 * diffed against an empty baseline first to materialize one CREATE
 * change per object. The filter then evaluates against the same shape
 * it would at plan time, and the surviving stableIds drive the prune.
 *
 * Dependency cascade is not applied. A scoped snapshot is partial by
 * design: out-of-scope owners, roles, and types must exist on the
 * target DB at apply time. Cascading would expand the filter beyond
 * what the caller asked for and, in practice, collapse schema-scoped
 * exports whose kept objects reference cluster-scoped owners.
 */

import { diffCatalogs } from "./catalog.diff.ts";
import { Catalog, createEmptyCatalog } from "./catalog.model.ts";
import { compileFilterDSL, type FilterDSL } from "./integrations/filter/dsl.ts";

export async function filterCatalog(
  catalog: Catalog,
  filter: FilterDSL,
): Promise<Catalog> {
  if (
    typeof filter === "object" &&
    filter !== null &&
    (filter as Record<string, unknown>).cascade === true
  ) {
    throw new Error(
      "Filter DSL `cascade: true` is not supported by catalog-export: " +
        "scoped snapshots are intentionally partial. Out-of-scope owners, " +
        "roles, and types must exist on the target DB at apply time.",
    );
  }

  const empty = await createEmptyCatalog(catalog.version, catalog.currentUser);
  const changes = diffCatalogs(empty, catalog);
  const filterFn = compileFilterDSL(filter);

  const keep = new Set<string>();
  for (const change of changes) {
    if (!filterFn(change)) continue;
    for (const id of change.creates ?? []) keep.add(id);
  }

  return pruneCatalog(catalog, keep);
}

function filterRecord<T>(
  record: Record<string, T>,
  keep: ReadonlySet<string>,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).filter(([id]) => keep.has(id)),
  );
}

function pruneCatalog(catalog: Catalog, keep: ReadonlySet<string>): Catalog {
  const tables = filterRecord(catalog.tables, keep);
  const materializedViews = filterRecord(catalog.materializedViews, keep);

  return new Catalog({
    aggregates: filterRecord(catalog.aggregates, keep),
    collations: filterRecord(catalog.collations, keep),
    compositeTypes: filterRecord(catalog.compositeTypes, keep),
    domains: filterRecord(catalog.domains, keep),
    enums: filterRecord(catalog.enums, keep),
    extensions: filterRecord(catalog.extensions, keep),
    procedures: filterRecord(catalog.procedures, keep),
    indexes: filterRecord(catalog.indexes, keep),
    materializedViews,
    subscriptions: filterRecord(catalog.subscriptions, keep),
    publications: filterRecord(catalog.publications, keep),
    rlsPolicies: filterRecord(catalog.rlsPolicies, keep),
    roles: filterRecord(catalog.roles, keep),
    schemas: filterRecord(catalog.schemas, keep),
    sequences: filterRecord(catalog.sequences, keep),
    tables,
    triggers: filterRecord(catalog.triggers, keep),
    eventTriggers: filterRecord(catalog.eventTriggers, keep),
    rules: filterRecord(catalog.rules, keep),
    ranges: filterRecord(catalog.ranges, keep),
    views: filterRecord(catalog.views, keep),
    foreignDataWrappers: filterRecord(catalog.foreignDataWrappers, keep),
    servers: filterRecord(catalog.servers, keep),
    userMappings: filterRecord(catalog.userMappings, keep),
    foreignTables: filterRecord(catalog.foreignTables, keep),
    depends: catalog.depends.filter(
      (d) =>
        keep.has(d.dependent_stable_id) && keep.has(d.referenced_stable_id),
    ),
    indexableObjects: { ...tables, ...materializedViews },
    version: catalog.version,
    currentUser: catalog.currentUser,
  });
}
