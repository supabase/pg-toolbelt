import type { Sql } from "postgres";
import { extractCurrentUser, extractVersion } from "./context.ts";
import { extractDepends, type PgDepend } from "./depend.ts";
import {
  type Aggregate,
  extractAggregates,
} from "./objects/aggregate/aggregate.model.ts";
import type { BasePgModel, TableLikeObject } from "./objects/base.model.ts";
import {
  type Collation,
  extractCollations,
} from "./objects/collation/collation.model.ts";
import type { Domain } from "./objects/domain/domain.model.ts";
import { extractDomains } from "./objects/domain/domain.model.ts";
import {
  type EventTrigger,
  extractEventTriggers,
} from "./objects/event-trigger/event-trigger.model.ts";
import {
  type Extension,
  extractExtensions,
} from "./objects/extension/extension.model.ts";
import {
  extractForeignDataWrappers,
  type ForeignDataWrapper,
} from "./objects/foreign-data-wrapper/foreign-data-wrapper/foreign-data-wrapper.model.ts";
import {
  extractForeignTables,
  type ForeignTable,
} from "./objects/foreign-data-wrapper/foreign-table/foreign-table.model.ts";
import {
  extractServers,
  Server,
} from "./objects/foreign-data-wrapper/server/server.model.ts";
import {
  extractUserMappings,
  UserMapping,
} from "./objects/foreign-data-wrapper/user-mapping/user-mapping.model.ts";
import { extractIndexes, type Index } from "./objects/index/index.model.ts";
import {
  extractMaterializedViews,
  type MaterializedView,
} from "./objects/materialized-view/materialized-view.model.ts";
import {
  extractProcedures,
  type Procedure,
} from "./objects/procedure/procedure.model.ts";
import {
  extractPublications,
  type Publication,
} from "./objects/publication/publication.model.ts";
import {
  extractRlsPolicies,
  type RlsPolicy,
} from "./objects/rls-policy/rls-policy.model.ts";
import { extractRoles, type Role } from "./objects/role/role.model.ts";
import { extractRules, type Rule } from "./objects/rule/rule.model.ts";
import { extractSchemas, type Schema } from "./objects/schema/schema.model.ts";
import {
  extractSequences,
  type Sequence,
} from "./objects/sequence/sequence.model.ts";
import {
  extractSubscriptions,
  Subscription,
} from "./objects/subscription/subscription.model.ts";
import { extractTables, type Table } from "./objects/table/table.model.ts";
import {
  extractTriggers,
  type Trigger,
} from "./objects/trigger/trigger.model.ts";
import {
  type CompositeType,
  extractCompositeTypes,
} from "./objects/type/composite-type/composite-type.model.ts";
import { type Enum, extractEnums } from "./objects/type/enum/enum.model.ts";
import { extractRanges, type Range } from "./objects/type/range/range.model.ts";
import { extractViews, type View } from "./objects/view/view.model.ts";

const SUBSCRIPTION_CONNINFO_PLACEHOLDER =
  "host=__CONN_HOST__ port=__CONN_PORT__ dbname=__CONN_DBNAME__ user=__CONN_USER__ password=__CONN_PASSWORD__";

interface CatalogProps {
  aggregates: Record<string, Aggregate>;
  collations: Record<string, Collation>;
  compositeTypes: Record<string, CompositeType>;
  domains: Record<string, Domain>;
  enums: Record<string, Enum>;
  extensions: Record<string, Extension>;
  procedures: Record<string, Procedure>;
  indexes: Record<string, Index>;
  materializedViews: Record<string, MaterializedView>;
  subscriptions: Record<string, Subscription>;
  publications: Record<string, Publication>;
  rlsPolicies: Record<string, RlsPolicy>;
  roles: Record<string, Role>;
  schemas: Record<string, Schema>;
  sequences: Record<string, Sequence>;
  tables: Record<string, Table>;
  triggers: Record<string, Trigger>;
  eventTriggers: Record<string, EventTrigger>;
  rules: Record<string, Rule>;
  ranges: Record<string, Range>;
  views: Record<string, View>;
  foreignDataWrappers: Record<string, ForeignDataWrapper>;
  servers: Record<string, Server>;
  userMappings: Record<string, UserMapping>;
  foreignTables: Record<string, ForeignTable>;
  depends: PgDepend[];
  indexableObjects: Record<string, TableLikeObject>;
  version: number;
  currentUser: string;
}

export class Catalog {
  public readonly aggregates: CatalogProps["aggregates"];
  public readonly collations: CatalogProps["collations"];
  public readonly compositeTypes: CatalogProps["compositeTypes"];
  public readonly domains: CatalogProps["domains"];
  public readonly enums: CatalogProps["enums"];
  public readonly extensions: CatalogProps["extensions"];
  public readonly procedures: CatalogProps["procedures"];
  public readonly indexes: CatalogProps["indexes"];
  public readonly materializedViews: CatalogProps["materializedViews"];
  public readonly subscriptions: CatalogProps["subscriptions"];
  public readonly publications: CatalogProps["publications"];
  public readonly rlsPolicies: CatalogProps["rlsPolicies"];
  public readonly roles: CatalogProps["roles"];
  public readonly schemas: CatalogProps["schemas"];
  public readonly sequences: CatalogProps["sequences"];
  public readonly tables: CatalogProps["tables"];
  public readonly triggers: CatalogProps["triggers"];
  public readonly eventTriggers: CatalogProps["eventTriggers"];
  public readonly rules: CatalogProps["rules"];
  public readonly ranges: CatalogProps["ranges"];
  public readonly views: CatalogProps["views"];
  public readonly foreignDataWrappers: CatalogProps["foreignDataWrappers"];
  public readonly servers: CatalogProps["servers"];
  public readonly userMappings: CatalogProps["userMappings"];
  public readonly foreignTables: CatalogProps["foreignTables"];
  public readonly depends: CatalogProps["depends"];
  public readonly indexableObjects: CatalogProps["indexableObjects"];
  public readonly version: CatalogProps["version"];
  public readonly currentUser: CatalogProps["currentUser"];

  constructor(props: CatalogProps) {
    this.aggregates = props.aggregates;
    this.collations = props.collations;
    this.compositeTypes = props.compositeTypes;
    this.domains = props.domains;
    this.enums = props.enums;
    this.extensions = props.extensions;
    this.procedures = props.procedures;
    this.indexes = props.indexes;
    this.materializedViews = props.materializedViews;
    this.subscriptions = props.subscriptions;
    this.publications = props.publications;
    this.rlsPolicies = props.rlsPolicies;
    this.roles = props.roles;
    this.schemas = props.schemas;
    this.sequences = props.sequences;
    this.tables = props.tables;
    this.triggers = props.triggers;
    this.eventTriggers = props.eventTriggers;
    this.rules = props.rules;
    this.ranges = props.ranges;
    this.views = props.views;
    this.foreignDataWrappers = props.foreignDataWrappers;
    this.servers = props.servers;
    this.userMappings = props.userMappings;
    this.foreignTables = props.foreignTables;
    this.depends = props.depends;
    this.indexableObjects = props.indexableObjects;
    this.version = props.version;
    this.currentUser = props.currentUser;
  }
}

export async function extractCatalog(sql: Sql) {
  const [
    aggregates,
    collations,
    compositeTypes,
    domains,
    enums,
    extensions,
    indexes,
    materializedViews,
    subscriptions,
    publications,
    procedures,
    rlsPolicies,
    roles,
    schemas,
    sequences,
    tables,
    triggers,
    eventTriggers,
    rules,
    ranges,
    views,
    foreignDataWrappers,
    servers,
    userMappings,
    foreignTables,
    depends,
    version,
    currentUser,
  ] = await Promise.all([
    extractAggregates(sql).then(listToRecord),
    extractCollations(sql).then(listToRecord),
    extractCompositeTypes(sql).then(listToRecord),
    extractDomains(sql).then(listToRecord),
    extractEnums(sql).then(listToRecord),
    extractExtensions(sql).then(listToRecord),
    extractIndexes(sql).then(listToRecord),
    extractMaterializedViews(sql).then(listToRecord),
    extractSubscriptions(sql).then(listToRecord),
    extractPublications(sql).then(listToRecord),
    extractProcedures(sql).then(listToRecord),
    extractRlsPolicies(sql).then(listToRecord),
    extractRoles(sql).then(listToRecord),
    extractSchemas(sql).then(listToRecord),
    extractSequences(sql).then(listToRecord),
    extractTables(sql).then(listToRecord),
    extractTriggers(sql).then(listToRecord),
    extractEventTriggers(sql).then(listToRecord),
    extractRules(sql).then(listToRecord),
    extractRanges(sql).then(listToRecord),
    extractViews(sql).then(listToRecord),
    extractForeignDataWrappers(sql).then(listToRecord),
    extractServers(sql).then(listToRecord),
    extractUserMappings(sql).then(listToRecord),
    extractForeignTables(sql).then(listToRecord),
    extractDepends(sql),
    extractVersion(sql),
    extractCurrentUser(sql),
  ]);

  const indexableObjects = {
    ...tables,
    ...materializedViews,
  };

  const catalog = new Catalog({
    aggregates,
    collations,
    compositeTypes,
    domains,
    enums,
    extensions,
    procedures,
    indexes,
    materializedViews,
    subscriptions,
    publications,
    rlsPolicies,
    roles,
    schemas,
    sequences,
    tables,
    triggers,
    eventTriggers,
    rules,
    ranges,
    views,
    foreignDataWrappers,
    servers,
    userMappings,
    foreignTables,
    depends,
    indexableObjects,
    version,
    currentUser,
  });

  return normalizeCatalog(catalog);
}

function listToRecord<T extends BasePgModel>(list: T[]) {
  return Object.fromEntries(list.map((item) => [item.stableId, item]));
}

function normalizeCatalog(catalog: Catalog): Catalog {
  const servers = mapRecord(catalog.servers, (server) => {
    const maskedOptions = maskOptions(server.options);
    return new Server({
      name: server.name,
      owner: server.owner,
      foreign_data_wrapper: server.foreign_data_wrapper,
      type: server.type,
      version: server.version,
      options: maskedOptions,
      comment: server.comment,
      privileges: server.privileges,
    });
  });

  const userMappings = mapRecord(catalog.userMappings, (mapping) => {
    const maskedOptions = maskOptions(mapping.options);
    return new UserMapping({
      user: mapping.user,
      server: mapping.server,
      options: maskedOptions,
    });
  });

  const subscriptions = mapRecord(catalog.subscriptions, (subscription) => {
    return new Subscription({
      name: subscription.name,
      raw_name: subscription.raw_name,
      owner: subscription.owner,
      comment: subscription.comment,
      enabled: subscription.enabled,
      binary: subscription.binary,
      streaming: subscription.streaming,
      two_phase: subscription.two_phase,
      disable_on_error: subscription.disable_on_error,
      password_required: subscription.password_required,
      run_as_owner: subscription.run_as_owner,
      failover: subscription.failover,
      conninfo: SUBSCRIPTION_CONNINFO_PLACEHOLDER,
      slot_name: subscription.slot_name,
      slot_is_none: subscription.slot_is_none,
      replication_slot_created: subscription.replication_slot_created,
      synchronous_commit: subscription.synchronous_commit,
      publications: subscription.publications,
      origin: subscription.origin,
    });
  });

  return new Catalog({
    aggregates: catalog.aggregates,
    collations: catalog.collations,
    compositeTypes: catalog.compositeTypes,
    domains: catalog.domains,
    enums: catalog.enums,
    extensions: catalog.extensions,
    procedures: catalog.procedures,
    indexes: catalog.indexes,
    materializedViews: catalog.materializedViews,
    subscriptions,
    publications: catalog.publications,
    rlsPolicies: catalog.rlsPolicies,
    roles: catalog.roles,
    schemas: catalog.schemas,
    sequences: catalog.sequences,
    tables: catalog.tables,
    triggers: catalog.triggers,
    eventTriggers: catalog.eventTriggers,
    rules: catalog.rules,
    ranges: catalog.ranges,
    views: catalog.views,
    foreignDataWrappers: catalog.foreignDataWrappers,
    servers,
    userMappings,
    foreignTables: catalog.foreignTables,
    depends: catalog.depends,
    indexableObjects: catalog.indexableObjects,
    version: catalog.version,
    currentUser: catalog.currentUser,
  });
}

function maskOptions(options: string[] | null): string[] | null {
  if (!options || options.length === 0) return options;
  const masked: string[] = [];
  for (let i = 0; i < options.length; i += 2) {
    const key = options[i];
    const value = options[i + 1];
    if (key === undefined || value === undefined) continue;
    masked.push(key, `__OPTION_${key.toUpperCase()}__`);
  }
  return masked.length > 0 ? masked : null;
}

function mapRecord<TValue, TResult>(
  record: Record<string, TValue>,
  mapper: (value: TValue) => TResult,
): Record<string, TResult> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, mapper(value)]),
  );
}
