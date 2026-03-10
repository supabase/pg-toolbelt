/**
 * Catalog snapshot - full JSON-serializable representation of a Catalog.
 *
 * Enables catalog-export (snapshot a live DB) and catalog-import
 * (use a snapshot as source/target for createPlan).
 */

import { Schema as EffectSchema } from "effect";
import { Catalog } from "./catalog.model.ts";
import { PgDependSchema } from "./depend.ts";
import { Aggregate } from "./objects/aggregate/aggregate.model.ts";
import { Collation } from "./objects/collation/collation.model.ts";
import { Domain } from "./objects/domain/domain.model.ts";
import { EventTrigger } from "./objects/event-trigger/event-trigger.model.ts";
import { Extension } from "./objects/extension/extension.model.ts";
import { ForeignDataWrapper } from "./objects/foreign-data-wrapper/foreign-data-wrapper/foreign-data-wrapper.model.ts";
import { ForeignTable } from "./objects/foreign-data-wrapper/foreign-table/foreign-table.model.ts";
import { Server } from "./objects/foreign-data-wrapper/server/server.model.ts";
import { UserMapping } from "./objects/foreign-data-wrapper/user-mapping/user-mapping.model.ts";
import { Index } from "./objects/index/index.model.ts";
import { MaterializedView } from "./objects/materialized-view/materialized-view.model.ts";
import { Procedure } from "./objects/procedure/procedure.model.ts";
import { Publication } from "./objects/publication/publication.model.ts";
import { RlsPolicy } from "./objects/rls-policy/rls-policy.model.ts";
import { Role } from "./objects/role/role.model.ts";
import { Rule } from "./objects/rule/rule.model.ts";
import { Schema } from "./objects/schema/schema.model.ts";
import { Sequence } from "./objects/sequence/sequence.model.ts";
import { Subscription } from "./objects/subscription/subscription.model.ts";
import { Table } from "./objects/table/table.model.ts";
import { Trigger } from "./objects/trigger/trigger.model.ts";
import { CompositeType } from "./objects/type/composite-type/composite-type.model.ts";
import { Enum } from "./objects/type/enum/enum.model.ts";
import { Range } from "./objects/type/range/range.model.ts";
import { View } from "./objects/view/view.model.ts";

// ============================================================================
// Schema for validation on deserialization
// ============================================================================

const objectRecord = EffectSchema.Record(
  EffectSchema.String,
  EffectSchema.Record(EffectSchema.String, EffectSchema.Unknown),
);

// ============================================================================
// CatalogSnapshot type
// ============================================================================

/**
 * Full JSON-serializable representation of a Catalog.
 *
 * Every object record uses plain props objects (not class instances).
 * `indexableObjects` is omitted -- it is reconstructed on deserialization.
 */
const CatalogSnapshotSchema = EffectSchema.Struct({
  version: EffectSchema.Number,
  currentUser: EffectSchema.String,
  aggregates: objectRecord,
  collations: objectRecord,
  compositeTypes: objectRecord,
  domains: objectRecord,
  enums: objectRecord,
  extensions: objectRecord,
  procedures: objectRecord,
  indexes: objectRecord,
  materializedViews: objectRecord,
  subscriptions: objectRecord,
  publications: objectRecord,
  rlsPolicies: objectRecord,
  roles: objectRecord,
  schemas: objectRecord,
  sequences: objectRecord,
  tables: objectRecord,
  triggers: objectRecord,
  eventTriggers: objectRecord,
  rules: objectRecord,
  ranges: objectRecord,
  views: objectRecord,
  foreignDataWrappers: objectRecord,
  servers: objectRecord,
  userMappings: objectRecord,
  foreignTables: objectRecord,
  depends: EffectSchema.Array(PgDependSchema),
});

export type CatalogSnapshot = typeof CatalogSnapshotSchema.Type;

// ============================================================================
// Serialization
// ============================================================================

function spreadRecord<T>(
  record: Record<string, T>,
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(record).map(([key, instance]) => [
      key,
      { ...(instance as Record<string, unknown>) },
    ]),
  );
}

/**
 * Serialize Aggregate instances back to their Props shape.
 *
 * Aggregate renames `identity_arguments` -> `identityArguments` and trims it
 * on construction. We must map it back to `identity_arguments` so
 * deserialization through the constructor works.
 */
function serializeAggregates(
  record: Record<string, Aggregate>,
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(record).map(([key, agg]) => {
      const { identityArguments: _, ...rest } = agg as unknown as Record<
        string,
        unknown
      >;
      return [key, { ...rest, identity_arguments: agg.identityArguments }];
    }),
  );
}

/**
 * Serialize a Catalog to a JSON-serializable CatalogSnapshot.
 *
 * Expects a normalized catalog (as returned by `extractCatalog`).
 * BigInt values (Sequence min/max) are converted to strings by the
 * custom JSON replacer -- call `stringifyCatalogSnapshot` for JSON output.
 */
export function serializeCatalog(catalog: Catalog): CatalogSnapshot {
  return {
    version: catalog.version,
    currentUser: catalog.currentUser,
    aggregates: serializeAggregates(catalog.aggregates),
    collations: spreadRecord(catalog.collations),
    compositeTypes: spreadRecord(catalog.compositeTypes),
    domains: spreadRecord(catalog.domains),
    enums: spreadRecord(catalog.enums),
    extensions: spreadRecord(catalog.extensions),
    procedures: spreadRecord(catalog.procedures),
    indexes: spreadRecord(catalog.indexes),
    materializedViews: spreadRecord(catalog.materializedViews),
    subscriptions: spreadRecord(catalog.subscriptions),
    publications: spreadRecord(catalog.publications),
    rlsPolicies: spreadRecord(catalog.rlsPolicies),
    roles: spreadRecord(catalog.roles),
    schemas: spreadRecord(catalog.schemas),
    sequences: spreadRecord(catalog.sequences),
    tables: spreadRecord(catalog.tables),
    triggers: spreadRecord(catalog.triggers),
    eventTriggers: spreadRecord(catalog.eventTriggers),
    rules: spreadRecord(catalog.rules),
    ranges: spreadRecord(catalog.ranges),
    views: spreadRecord(catalog.views),
    foreignDataWrappers: spreadRecord(catalog.foreignDataWrappers),
    servers: spreadRecord(catalog.servers),
    userMappings: spreadRecord(catalog.userMappings),
    foreignTables: spreadRecord(catalog.foreignTables),
    depends: catalog.depends,
  };
}

/**
 * Serialize a CatalogSnapshot to a JSON string.
 *
 * Handles BigInt values (Sequence min/max) by converting them to strings.
 */
export function stringifyCatalogSnapshot(snapshot: CatalogSnapshot): string {
  return JSON.stringify(
    snapshot,
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    2,
  );
}

// ============================================================================
// Deserialization
// ============================================================================

function buildRecord<T>(
  record: Record<string, Record<string, unknown>>,
  ctor: new (props: never) => T,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).map(([key, props]) => [
      key,
      new ctor(props as never),
    ]),
  );
}

/**
 * Coerce BigInt fields in Sequence props from string back to BigInt.
 * JSON has no BigInt type, so these are stored as strings.
 */
function coerceSequenceBigInts(
  record: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(record).map(([key, props]) => [
      key,
      {
        ...props,
        minimum_value: BigInt(props.minimum_value as string | bigint),
        maximum_value: BigInt(props.maximum_value as string | bigint),
      },
    ]),
  );
}

/**
 * Deserialize a CatalogSnapshot (plain JSON data) back into a Catalog.
 *
 * Validates the top-level structure with the schema, then constructs model
 * class instances via their constructors. Rebuilds `indexableObjects`
 * from tables + materializedViews.
 */
export function deserializeCatalog(data: unknown): Catalog {
  const s = EffectSchema.decodeUnknownSync(CatalogSnapshotSchema)(data);

  const tables = buildRecord(s.tables, Table);
  const materializedViews = buildRecord(s.materializedViews, MaterializedView);

  return new Catalog({
    version: s.version,
    currentUser: s.currentUser,
    aggregates: buildRecord(s.aggregates, Aggregate),
    collations: buildRecord(s.collations, Collation),
    compositeTypes: buildRecord(s.compositeTypes, CompositeType),
    domains: buildRecord(s.domains, Domain),
    enums: buildRecord(s.enums, Enum),
    extensions: buildRecord(s.extensions, Extension),
    procedures: buildRecord(s.procedures, Procedure),
    indexes: buildRecord(s.indexes, Index),
    materializedViews,
    subscriptions: buildRecord(s.subscriptions, Subscription),
    publications: buildRecord(s.publications, Publication),
    rlsPolicies: buildRecord(s.rlsPolicies, RlsPolicy),
    roles: buildRecord(s.roles, Role),
    schemas: buildRecord(s.schemas, Schema),
    sequences: buildRecord(coerceSequenceBigInts(s.sequences), Sequence),
    tables,
    triggers: buildRecord(s.triggers, Trigger),
    eventTriggers: buildRecord(s.eventTriggers, EventTrigger),
    rules: buildRecord(s.rules, Rule),
    ranges: buildRecord(s.ranges, Range),
    views: buildRecord(s.views, View),
    foreignDataWrappers: buildRecord(s.foreignDataWrappers, ForeignDataWrapper),
    servers: buildRecord(s.servers, Server),
    userMappings: buildRecord(s.userMappings, UserMapping),
    foreignTables: buildRecord(s.foreignTables, ForeignTable),
    depends: [...s.depends],
    indexableObjects: { ...tables, ...materializedViews },
  });
}
