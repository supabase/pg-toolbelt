/**
 * @supabase/pg-delta — API Reference
 *
 * This module is a dedicated documentation entry point. It re-exports only the
 * types relevant to authoring custom integration filters and does **not** affect
 * the public API surface exposed by the package's main entry point.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Filter DSL
// ---------------------------------------------------------------------------

export type {
  FilterDSL,
  FilterPattern,
  PathPattern,
} from "./core/integrations/filter/dsl.ts";
export type { FlatValue } from "./core/integrations/filter/flatten.ts";

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------

export type { IntegrationDSL } from "./core/integrations/integration-dsl.ts";
export type { SerializeDSL } from "./core/integrations/serialize/dsl.ts";

// ---------------------------------------------------------------------------
// Change Types — Base & Top-Level Unions
// ---------------------------------------------------------------------------

export type {
  Change,
  OBJECT_TYPE_TO_PROPERTY_KEY,
} from "./core/change.types.ts";

export { BaseChange } from "./core/objects/base.change.ts";

// Top-level union types (each combines all change variants for an object type)
export type { AggregateChange } from "./core/objects/aggregate/changes/aggregate.types.ts";
export type { CollationChange } from "./core/objects/collation/changes/collation.types.ts";
export type { DomainChange } from "./core/objects/domain/changes/domain.types.ts";
export type { EventTriggerChange } from "./core/objects/event-trigger/changes/event-trigger.types.ts";
export type { ExtensionChange } from "./core/objects/extension/changes/extension.types.ts";
export type { ForeignDataWrapperChange } from "./core/objects/foreign-data-wrapper/foreign-data-wrapper.types.ts";
export type { IndexChange } from "./core/objects/index/changes/index.types.ts";
export type { LanguageChange } from "./core/objects/language/changes/language.types.ts";
export type { MaterializedViewChange } from "./core/objects/materialized-view/changes/materialized-view.types.ts";
export type { ProcedureChange } from "./core/objects/procedure/changes/procedure.types.ts";
export type { PublicationChange } from "./core/objects/publication/changes/publication.types.ts";
export type { RlsPolicyChange } from "./core/objects/rls-policy/changes/rls-policy.types.ts";
export type { RoleChange } from "./core/objects/role/changes/role.types.ts";
export type { RuleChange } from "./core/objects/rule/changes/rule.types.ts";
export type { SchemaChange } from "./core/objects/schema/changes/schema.types.ts";
export type { SequenceChange } from "./core/objects/sequence/changes/sequence.types.ts";
export type { SubscriptionChange } from "./core/objects/subscription/changes/subscription.types.ts";
export type { TableChange } from "./core/objects/table/changes/table.types.ts";
export type { TriggerChange } from "./core/objects/trigger/changes/trigger.types.ts";
export type { TypeChange } from "./core/objects/type/type.types.ts";
export type { ViewChange } from "./core/objects/view/changes/view.types.ts";

// ---------------------------------------------------------------------------
// Change Types — FDW & Type Sub-Unions
// ---------------------------------------------------------------------------

// Inner FDW union renamed to avoid collision with the outer ForeignDataWrapperChange
export type { ForeignDataWrapperChange as FDWChange } from "./core/objects/foreign-data-wrapper/foreign-data-wrapper/changes/foreign-data-wrapper.types.ts";
export type { ServerChange } from "./core/objects/foreign-data-wrapper/server/changes/server.types.ts";
export type { UserMappingChange } from "./core/objects/foreign-data-wrapper/user-mapping/changes/user-mapping.types.ts";
export type { ForeignTableChange } from "./core/objects/foreign-data-wrapper/foreign-table/changes/foreign-table.types.ts";

export type { CompositeTypeChange } from "./core/objects/type/composite-type/changes/composite-type.types.ts";
export type { EnumChange } from "./core/objects/type/enum/changes/enum.types.ts";
export type { RangeChange } from "./core/objects/type/range/changes/range.types.ts";

// ---------------------------------------------------------------------------
// Change Types — Concrete Change Classes (all object types)
// ---------------------------------------------------------------------------

// Aggregate
export * from "./core/objects/aggregate/changes/aggregate.alter.ts";
export * from "./core/objects/aggregate/changes/aggregate.create.ts";
export * from "./core/objects/aggregate/changes/aggregate.drop.ts";
export * from "./core/objects/aggregate/changes/aggregate.comment.ts";
export * from "./core/objects/aggregate/changes/aggregate.privilege.ts";

// Collation
export * from "./core/objects/collation/changes/collation.alter.ts";
export * from "./core/objects/collation/changes/collation.create.ts";
export * from "./core/objects/collation/changes/collation.drop.ts";
export * from "./core/objects/collation/changes/collation.comment.ts";

// Domain
export * from "./core/objects/domain/changes/domain.alter.ts";
export * from "./core/objects/domain/changes/domain.create.ts";
export * from "./core/objects/domain/changes/domain.drop.ts";
export * from "./core/objects/domain/changes/domain.comment.ts";
export * from "./core/objects/domain/changes/domain.privilege.ts";

// Event Trigger
export * from "./core/objects/event-trigger/changes/event-trigger.alter.ts";
export * from "./core/objects/event-trigger/changes/event-trigger.create.ts";
export * from "./core/objects/event-trigger/changes/event-trigger.drop.ts";
export * from "./core/objects/event-trigger/changes/event-trigger.comment.ts";

// Extension
export * from "./core/objects/extension/changes/extension.alter.ts";
export * from "./core/objects/extension/changes/extension.create.ts";
export * from "./core/objects/extension/changes/extension.drop.ts";
export * from "./core/objects/extension/changes/extension.comment.ts";

// Foreign Data Wrapper — FDW wrapper
export * from "./core/objects/foreign-data-wrapper/foreign-data-wrapper/changes/foreign-data-wrapper.alter.ts";
export * from "./core/objects/foreign-data-wrapper/foreign-data-wrapper/changes/foreign-data-wrapper.create.ts";
export * from "./core/objects/foreign-data-wrapper/foreign-data-wrapper/changes/foreign-data-wrapper.drop.ts";
export * from "./core/objects/foreign-data-wrapper/foreign-data-wrapper/changes/foreign-data-wrapper.comment.ts";
export * from "./core/objects/foreign-data-wrapper/foreign-data-wrapper/changes/foreign-data-wrapper.privilege.ts";

// Foreign Data Wrapper — Foreign Table
export * from "./core/objects/foreign-data-wrapper/foreign-table/changes/foreign-table.alter.ts";
export * from "./core/objects/foreign-data-wrapper/foreign-table/changes/foreign-table.create.ts";
export * from "./core/objects/foreign-data-wrapper/foreign-table/changes/foreign-table.drop.ts";
export * from "./core/objects/foreign-data-wrapper/foreign-table/changes/foreign-table.comment.ts";
export * from "./core/objects/foreign-data-wrapper/foreign-table/changes/foreign-table.privilege.ts";

// Foreign Data Wrapper — Server
export * from "./core/objects/foreign-data-wrapper/server/changes/server.alter.ts";
export * from "./core/objects/foreign-data-wrapper/server/changes/server.create.ts";
export * from "./core/objects/foreign-data-wrapper/server/changes/server.drop.ts";
export * from "./core/objects/foreign-data-wrapper/server/changes/server.comment.ts";
export * from "./core/objects/foreign-data-wrapper/server/changes/server.privilege.ts";

// Foreign Data Wrapper — User Mapping
export * from "./core/objects/foreign-data-wrapper/user-mapping/changes/user-mapping.alter.ts";
export * from "./core/objects/foreign-data-wrapper/user-mapping/changes/user-mapping.create.ts";
export * from "./core/objects/foreign-data-wrapper/user-mapping/changes/user-mapping.drop.ts";

// Index
export * from "./core/objects/index/changes/index.alter.ts";
export * from "./core/objects/index/changes/index.create.ts";
export * from "./core/objects/index/changes/index.drop.ts";
export * from "./core/objects/index/changes/index.comment.ts";

// Language
export * from "./core/objects/language/changes/language.alter.ts";
export * from "./core/objects/language/changes/language.create.ts";
export * from "./core/objects/language/changes/language.drop.ts";
export * from "./core/objects/language/changes/language.comment.ts";
export * from "./core/objects/language/changes/language.privilege.ts";

// Materialized View
export * from "./core/objects/materialized-view/changes/materialized-view.alter.ts";
export * from "./core/objects/materialized-view/changes/materialized-view.create.ts";
export * from "./core/objects/materialized-view/changes/materialized-view.drop.ts";
export * from "./core/objects/materialized-view/changes/materialized-view.comment.ts";
export * from "./core/objects/materialized-view/changes/materialized-view.privilege.ts";

// Procedure
export * from "./core/objects/procedure/changes/procedure.alter.ts";
export * from "./core/objects/procedure/changes/procedure.create.ts";
export * from "./core/objects/procedure/changes/procedure.drop.ts";
export * from "./core/objects/procedure/changes/procedure.comment.ts";
export * from "./core/objects/procedure/changes/procedure.privilege.ts";

// Publication
export * from "./core/objects/publication/changes/publication.alter.ts";
export * from "./core/objects/publication/changes/publication.create.ts";
export * from "./core/objects/publication/changes/publication.drop.ts";
export * from "./core/objects/publication/changes/publication.comment.ts";

// RLS Policy
export * from "./core/objects/rls-policy/changes/rls-policy.alter.ts";
export * from "./core/objects/rls-policy/changes/rls-policy.create.ts";
export * from "./core/objects/rls-policy/changes/rls-policy.drop.ts";
export * from "./core/objects/rls-policy/changes/rls-policy.comment.ts";

// Role
export * from "./core/objects/role/changes/role.alter.ts";
export * from "./core/objects/role/changes/role.create.ts";
export * from "./core/objects/role/changes/role.drop.ts";
export * from "./core/objects/role/changes/role.comment.ts";
export * from "./core/objects/role/changes/role.privilege.ts";

// Rule
export * from "./core/objects/rule/changes/rule.alter.ts";
export * from "./core/objects/rule/changes/rule.create.ts";
export * from "./core/objects/rule/changes/rule.drop.ts";
export * from "./core/objects/rule/changes/rule.comment.ts";

// Schema
export * from "./core/objects/schema/changes/schema.alter.ts";
export * from "./core/objects/schema/changes/schema.create.ts";
export * from "./core/objects/schema/changes/schema.drop.ts";
export * from "./core/objects/schema/changes/schema.comment.ts";
export * from "./core/objects/schema/changes/schema.privilege.ts";

// Sequence
export * from "./core/objects/sequence/changes/sequence.alter.ts";
export * from "./core/objects/sequence/changes/sequence.create.ts";
export * from "./core/objects/sequence/changes/sequence.drop.ts";
export * from "./core/objects/sequence/changes/sequence.comment.ts";
export * from "./core/objects/sequence/changes/sequence.privilege.ts";

// Subscription
export * from "./core/objects/subscription/changes/subscription.alter.ts";
export * from "./core/objects/subscription/changes/subscription.create.ts";
export * from "./core/objects/subscription/changes/subscription.drop.ts";
export * from "./core/objects/subscription/changes/subscription.comment.ts";

// Table
export * from "./core/objects/table/changes/table.alter.ts";
export * from "./core/objects/table/changes/table.create.ts";
export * from "./core/objects/table/changes/table.drop.ts";
export * from "./core/objects/table/changes/table.comment.ts";
export * from "./core/objects/table/changes/table.privilege.ts";

// Trigger
export * from "./core/objects/trigger/changes/trigger.alter.ts";
export * from "./core/objects/trigger/changes/trigger.create.ts";
export * from "./core/objects/trigger/changes/trigger.drop.ts";
export * from "./core/objects/trigger/changes/trigger.comment.ts";

// Type — Composite
export * from "./core/objects/type/composite-type/changes/composite-type.alter.ts";
export * from "./core/objects/type/composite-type/changes/composite-type.create.ts";
export * from "./core/objects/type/composite-type/changes/composite-type.drop.ts";
export * from "./core/objects/type/composite-type/changes/composite-type.comment.ts";
export * from "./core/objects/type/composite-type/changes/composite-type.privilege.ts";

// Type — Enum
export * from "./core/objects/type/enum/changes/enum.alter.ts";
export * from "./core/objects/type/enum/changes/enum.create.ts";
export * from "./core/objects/type/enum/changes/enum.drop.ts";
export * from "./core/objects/type/enum/changes/enum.comment.ts";
export * from "./core/objects/type/enum/changes/enum.privilege.ts";

// Type — Range
export * from "./core/objects/type/range/changes/range.alter.ts";
export * from "./core/objects/type/range/changes/range.create.ts";
export * from "./core/objects/type/range/changes/range.drop.ts";
export * from "./core/objects/type/range/changes/range.comment.ts";
export * from "./core/objects/type/range/changes/range.privilege.ts";

// View
export * from "./core/objects/view/changes/view.alter.ts";
export * from "./core/objects/view/changes/view.create.ts";
export * from "./core/objects/view/changes/view.drop.ts";
export * from "./core/objects/view/changes/view.comment.ts";
export * from "./core/objects/view/changes/view.privilege.ts";
