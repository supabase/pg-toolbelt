/**
 * @supabase/pg-delta — Filter DSL Reference
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
// Change Types
// ---------------------------------------------------------------------------

export type {
  Change,
  OBJECT_TYPE_TO_PROPERTY_KEY,
} from "./core/change.types.ts";
// Constituent change union types
export type { AggregateChange } from "./core/objects/aggregate/changes/aggregate.types.ts";
export { BaseChange } from "./core/objects/base.change.ts";
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
