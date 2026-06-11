/**
 * Type definitions for the Plan module.
 */

import z from "zod";
import type { Change } from "../change.types.ts";
import type { Integration } from "../integrations/integration.types.ts";
import type { CommitBoundaryReason } from "../objects/base.change.ts";

// ============================================================================
// Core Types
// ============================================================================

export type PlanRisk =
  | { level: "safe" }
  | { level: "data_loss"; statements: string[] };

export type TransactionMode = "transactional" | "none";

/**
 * Why a migration unit starts a new execution boundary.
 *
 * - `"default"` — the first (or only) unit of the plan.
 * - `"non_transactional"` — the unit's statement cannot run inside a
 *   transaction block (see `BaseChange.nonTransactional`).
 * - commit-visibility kinds (see `BaseChange.commitBoundary`) — the previous
 *   unit produced effects that are only usable after COMMIT.
 */
export type ExecutionBoundaryReason =
  | "default"
  | "non_transactional"
  | CommitBoundaryReason;

/**
 * An ordered group of SQL statements that share one execution context.
 *
 * Transactional units are applied inside an explicit BEGIN/COMMIT;
 * non-transactional units run their single statement without a wrapper.
 */
export interface MigrationUnit {
  transactionMode: TransactionMode;
  reason: ExecutionBoundaryReason;
  statements: string[];
}

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
 * Plan schema for serialization/deserialization.
 */
export const PlanSchema = z.object({
  version: z.number(),
  toolVersion: z.string().optional(),
  source: z.object({
    fingerprint: z.string(),
  }),
  target: z.object({
    fingerprint: z.string(),
  }),
  units: z
    .array(
      z.object({
        transactionMode: z.enum(["transactional", "none"]),
        reason: z.enum([
          "default",
          "non_transactional",
          "enum_value_visibility",
        ]),
        statements: z.array(z.string()),
      }),
    )
    .optional(),
  /** Session-level statements (SET ROLE, ...) applied once before the units. */
  sessionStatements: z.array(z.string()).optional(),
  /**
   * Legacy v1 plans only: the flat statement list. Converted to units by
   * `normalizePlan`; never emitted by `createPlan`/`serializePlan`.
   */
  statements: z.array(z.string()).optional(),
  role: z.string().optional(),
  filter: z.any().optional(), // FilterDSL - complex recursive type, validated at compile time
  serialize: z.any().optional(), // SerializeDSL - complex recursive type, validated at compile time
  risk: z
    .discriminatedUnion("level", [
      z.object({
        level: z.literal("safe"),
      }),
      z.object({
        level: z.literal("data_loss"),
        statements: z.array(z.string()),
      }),
    ])
    .optional(),
});

export type SerializedPlan = z.infer<typeof PlanSchema>;

/**
 * A migration plan containing all changes to transform one database schema
 * into another, as an ordered list of execution-aware migration units.
 *
 * `units` and `sessionStatements` are the single source of truth: render via
 * `renderPlanSql`/`renderPlanFiles`, or flatten via `flattenPlanStatements`.
 */
export type Plan = Omit<
  SerializedPlan,
  "units" | "statements" | "sessionStatements"
> & {
  units: MigrationUnit[];
  sessionStatements: string[];
};

/**
 * Options for creating a plan.
 */
export interface CreatePlanOptions {
  /** Filter - either FilterDSL (stored in plan) or ChangeFilter function (not stored) */
  filter?: Integration["filter"];
  /** Serialize - either SerializeDSL (stored in plan) or ChangeSerializer function (not stored) */
  serialize?: Integration["serialize"];
  /** Role to use when executing the migration (SET ROLE will be added to statements) */
  role?: string;
  /**
   * When true, don't subtract privileges covered by ALTER DEFAULT PRIVILEGES
   * from explicit GRANTs during diffing. Use this for declarative export where
   * the output must be self-contained and not rely on statement execution order.
   */
  skipDefaultPrivilegeSubtraction?: boolean;
  /**
   * Number of retry attempts for catalog extractors when `pg_get_*def()`
   * returns NULL for at least one row (a transient race with concurrent DDL).
   * Total attempts is `extractRetries + 1`. When undefined, the value is read
   * from the `PGDELTA_EXTRACT_RETRIES` environment variable, falling back to
   * a default of 1 (i.e. the first attempt plus one retry, 2 attempts total).
   */
  extractRetries?: number;
}
