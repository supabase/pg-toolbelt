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
  type Subscription,
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
    this.depends = props.depends;
    this.indexableObjects = props.indexableObjects;
    this.version = props.version;
    this.currentUser = props.currentUser;
  }
}

const ENABLED_CATALOG_FEATURES: Array<
  Exclude<keyof CatalogProps, "indexableObjects">
> = [
  "aggregates",
  "collations",
  "compositeTypes",
  "domains",
  "enums",
  "extensions",
  "procedures",
  "indexes",
  "materializedViews",
  "subscriptions",
  "publications",
  "rlsPolicies",
  "roles",
  "schemas",
  "sequences",
  "tables",
  "triggers",
  "eventTriggers",
  "rules",
  "ranges",
  "views",
  "depends",
  "version",
  "currentUser",
];

const FEATURES_TO_CONVERT_TO_RECORD: Set<keyof CatalogProps> = new Set([
  "aggregates",
  "collations",
  "compositeTypes",
  "domains",
  "enums",
  "extensions",
  "procedures",
  "indexes",
  "materializedViews",
  "subscriptions",
  "publications",
  "rlsPolicies",
  "roles",
  "schemas",
  "sequences",
  "tables",
  "triggers",
  "eventTriggers",
  "rules",
  "ranges",
  "views",
]);

const ALL_CATALOG_FEATURES: Record<
  Exclude<keyof CatalogProps, "indexableObjects">,
  {
    shouldConvertToRecord: boolean;
    extractor: (sql: Sql) => Promise<unknown>;
  }
> = {
  aggregates: {
    shouldConvertToRecord: true,
    extractor: extractAggregates,
  },
  collations: {
    shouldConvertToRecord: true,
    extractor: extractCollations,
  },
  compositeTypes: {
    shouldConvertToRecord: true,
    extractor: extractCompositeTypes,
  },
  domains: {
    shouldConvertToRecord: true,
    extractor: extractDomains,
  },
  enums: {
    shouldConvertToRecord: true,
    extractor: extractEnums,
  },
  extensions: {
    shouldConvertToRecord: true,
    extractor: extractExtensions,
  },
  procedures: {
    shouldConvertToRecord: true,
    extractor: extractProcedures,
  },
  indexes: {
    shouldConvertToRecord: true,
    extractor: extractIndexes,
  },
  materializedViews: {
    shouldConvertToRecord: true,
    extractor: extractMaterializedViews,
  },
  subscriptions: {
    shouldConvertToRecord: true,
    extractor: extractSubscriptions,
  },
  publications: {
    shouldConvertToRecord: true,
    extractor: extractPublications,
  },
  rlsPolicies: {
    shouldConvertToRecord: true,
    extractor: extractRlsPolicies,
  },
  roles: {
    shouldConvertToRecord: true,
    extractor: extractRoles,
  },
  schemas: {
    shouldConvertToRecord: true,
    extractor: extractSchemas,
  },
  sequences: {
    shouldConvertToRecord: true,
    extractor: extractSequences,
  },
  tables: {
    shouldConvertToRecord: true,
    extractor: extractTables,
  },
  triggers: {
    shouldConvertToRecord: true,
    extractor: extractTriggers,
  },
  eventTriggers: {
    shouldConvertToRecord: true,
    extractor: extractEventTriggers,
  },
  rules: {
    shouldConvertToRecord: true,
    extractor: extractRules,
  },
  ranges: {
    shouldConvertToRecord: true,
    extractor: extractRanges,
  },
  views: {
    shouldConvertToRecord: true,
    extractor: extractViews,
  },
  depends: {
    shouldConvertToRecord: false,
    extractor: extractDepends,
  },
  version: {
    shouldConvertToRecord: false,
    extractor: extractVersion,
  },
  currentUser: {
    shouldConvertToRecord: false,
    extractor: extractCurrentUser,
  },
};

export async function extractCatalog(sql: Sql): Promise<Catalog> {
  // Extract all enabled features concurrently
  const extractionResults = await Promise.all(
    ENABLED_CATALOG_FEATURES.map((feature) =>
      ALL_CATALOG_FEATURES[feature].extractor(sql)
    )
  );

  // Assemble catalog data
  const catalogData: Partial<CatalogProps> = {};
  ENABLED_CATALOG_FEATURES.forEach((feature, index) => {
    const result = extractionResults[index];
    if (FEATURES_TO_CONVERT_TO_RECORD.has(feature)) {
      catalogData[feature] = listToRecord(
        result as unknown as BasePgModel[]
      ) as never;
    } else {
      catalogData[feature] = result as never;
    }
  });

  // Build indexableObjects map
  const indexableObjects: Record<string, TableLikeObject> = {};
  for (const tableId in catalogData.tables as Record<string, Table>) {
    indexableObjects[tableId] = catalogData.tables![tableId];
  }
  for (const mvId in catalogData.materializedViews as Record<
    string,
    MaterializedView
  >) {
    indexableObjects[mvId] = catalogData.materializedViews![mvId];
  }

  return new Catalog(
    Object.assign(catalogData, { indexableObjects }) as CatalogProps
  );
}

function listToRecord<T extends BasePgModel>(list: T[]) {
  return Object.fromEntries(list.map((item) => [item.stableId, item]));
}
