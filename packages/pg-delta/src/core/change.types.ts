import type { AggregateChange } from "./objects/aggregate/changes/aggregate.types.ts";
import type { CollationChange } from "./objects/collation/changes/collation.types.ts";
import type { DomainChange } from "./objects/domain/changes/domain.types.ts";
import type { EventTriggerChange } from "./objects/event-trigger/changes/event-trigger.types.ts";
import type { ExtensionChange } from "./objects/extension/changes/extension.types.ts";
import type { ForeignDataWrapperChange } from "./objects/foreign-data-wrapper/foreign-data-wrapper.types.ts";
import type { IndexChange } from "./objects/index/changes/index.types.ts";
import type { LanguageChange } from "./objects/language/changes/language.types.ts";
import type { MaterializedViewChange } from "./objects/materialized-view/changes/materialized-view.types.ts";
import type { ProcedureChange } from "./objects/procedure/changes/procedure.types.ts";
import type { PublicationChange } from "./objects/publication/changes/publication.types.ts";
import type { RlsPolicyChange } from "./objects/rls-policy/changes/rls-policy.types.ts";
import type { RoleChange } from "./objects/role/changes/role.types.ts";
import type { RuleChange } from "./objects/rule/changes/rule.types.ts";
import type { SchemaChange } from "./objects/schema/changes/schema.types.ts";
import type { SequenceChange } from "./objects/sequence/changes/sequence.types.ts";
import type { SubscriptionChange } from "./objects/subscription/changes/subscription.types.ts";
import type { TableChange } from "./objects/table/changes/table.types.ts";
import type { TriggerChange } from "./objects/trigger/changes/trigger.types.ts";
import type { TypeChange } from "./objects/type/type.types.ts";
import type { ViewChange } from "./objects/view/changes/view.types.ts";

export type Change =
  | AggregateChange
  | CollationChange
  | DomainChange
  | ExtensionChange
  | IndexChange
  | LanguageChange
  | MaterializedViewChange
  | SubscriptionChange
  | PublicationChange
  | ProcedureChange
  | RlsPolicyChange
  | RoleChange
  | SchemaChange
  | SequenceChange
  | TableChange
  | TriggerChange
  | EventTriggerChange
  | RuleChange
  | TypeChange
  | ViewChange
  | ForeignDataWrapperChange;

/**
 * Maps objectType values to the JS property key on the Change object
 * Ensure the values assignations are exhaustive.
 */
export const OBJECT_TYPE_TO_PROPERTY_KEY: {
  [K in Change["objectType"]]: string;
} = {
  aggregate: "aggregate",
  collation: "collation",
  composite_type: "compositeType",
  domain: "domain",
  enum: "enum",
  event_trigger: "eventTrigger",
  extension: "extension",
  foreign_data_wrapper: "foreignDataWrapper",
  foreign_table: "foreignTable",
  index: "index",
  language: "language",
  materialized_view: "materializedView",
  procedure: "procedure",
  publication: "publication",
  range: "range",
  rls_policy: "policy",
  role: "role",
  rule: "rule",
  schema: "schema",
  sequence: "sequence",
  server: "server",
  subscription: "subscription",
  table: "table",
  trigger: "trigger",
  user_mapping: "userMapping",
  view: "view",
};
