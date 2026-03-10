/**
 * Type definitions for the Plan module.
 */

import { Schema } from "effect";
import type { Change } from "../change.types.ts";
import type { FilterDSL } from "../integrations/filter/dsl.ts";
import type { ChangeFilter } from "../integrations/filter/filter.types.ts";
import type { SerializeDSL } from "../integrations/serialize/dsl.ts";
import type { ChangeSerializer } from "../integrations/serialize/serialize.types.ts";

// ============================================================================
// Core Types
// ============================================================================

/**
 * All supported object types in the system.
 * Derived from the Change union type's objectType discriminant.
 */
type ObjectType = Change["objectType"];

/**
 * Parent types for child objects.
 */
export type ParentType = Extract<
  ObjectType,
  "table" | "view" | "materialized_view" | "foreign_table"
>;

/**
 * A change entry storing both serialized and original change for instanceof checks.
 */
export interface ChangeEntry {
  original: Change;
}

/**
 * A group of changes organized by operation.
 */
export interface ChangeGroup {
  create: ChangeEntry[];
  alter: ChangeEntry[];
  drop: ChangeEntry[];
}

/**
 * Children objects of a table/view (indexes, triggers, policies, etc.)
 */
export interface TableChildren {
  changes: ChangeGroup;
  columns: ChangeGroup;
  indexes: ChangeGroup;
  triggers: ChangeGroup;
  rules: ChangeGroup;
  policies: ChangeGroup;
  /** Partition tables (only for partitioned tables) */
  partitions: Record<string, TableChildren>;
}

/**
 * Children objects of a materialized view
 */
export interface MaterializedViewChildren {
  changes: ChangeGroup;
  indexes: ChangeGroup;
}

/**
 * Type grouping within a schema
 */
export interface TypeGroup {
  enums: ChangeGroup;
  composites: ChangeGroup;
  ranges: ChangeGroup;
  domains: ChangeGroup;
}

/**
 * Schema-level grouping of objects
 */
export interface SchemaGroup {
  changes: ChangeGroup;
  tables: Record<string, TableChildren>;
  views: Record<string, TableChildren>;
  materializedViews: Record<string, MaterializedViewChildren>;
  functions: ChangeGroup;
  procedures: ChangeGroup;
  aggregates: ChangeGroup;
  sequences: ChangeGroup;
  types: TypeGroup;
  collations: ChangeGroup;
  foreignTables: Record<string, TableChildren>;
}

/**
 * Cluster-wide objects (no schema)
 */
export interface ClusterGroup {
  roles: ChangeGroup;
  extensions: ChangeGroup;
  eventTriggers: ChangeGroup;
  publications: ChangeGroup;
  subscriptions: ChangeGroup;
  foreignDataWrappers: ChangeGroup;
  servers: ChangeGroup;
  userMappings: ChangeGroup;
}

/**
 * Fully hierarchical plan structure for tree display.
 */
export interface HierarchicalPlan {
  cluster: ClusterGroup;
  schemas: Record<string, SchemaGroup>;
}

/**
 * Plan risk schema — either safe or data_loss with affected statements.
 */
const PlanRiskSchema = Schema.Union([
  Schema.Struct({ level: Schema.Literal("safe") }),
  Schema.Struct({
    level: Schema.Literal("data_loss"),
    statements: Schema.mutable(Schema.Array(Schema.String)),
  }),
]);

/**
 * Plan schema for serialization/deserialization.
 */
export const PlanSchema = Schema.Struct({
  version: Schema.Number,
  toolVersion: Schema.optional(Schema.String),
  source: Schema.Struct({ fingerprint: Schema.String }),
  target: Schema.Struct({ fingerprint: Schema.String }),
  statements: Schema.mutable(Schema.Array(Schema.String)),
  role: Schema.optional(Schema.String),
  filter: Schema.optional(Schema.Unknown), // FilterDSL - complex recursive type, validated at compile time
  serialize: Schema.optional(Schema.Unknown), // SerializeDSL - complex recursive type, validated at compile time
  risk: Schema.optional(PlanRiskSchema),
});

/**
 * A migration plan containing all changes to transform one database schema into another.
 */
export type Plan = typeof PlanSchema.Type;
export type PlanRisk = typeof PlanRiskSchema.Type;

/**
 * Options for creating a plan.
 */
export interface CreatePlanOptions {
  /** Filter - either FilterDSL (stored in plan) or ChangeFilter function (not stored) */
  filter?: FilterDSL | ChangeFilter;
  /** Serialize - either SerializeDSL (stored in plan) or ChangeSerializer function (not stored) */
  serialize?: SerializeDSL | ChangeSerializer;
  /** Role to use when executing the migration (SET ROLE will be added to statements) */
  role?: string;
  /**
   * When true, don't subtract privileges covered by ALTER DEFAULT PRIVILEGES
   * from explicit GRANTs during diffing. Use this for declarative export where
   * the output must be self-contained and not rely on statement execution order.
   */
  skipDefaultPrivilegeSubtraction?: boolean;
}
