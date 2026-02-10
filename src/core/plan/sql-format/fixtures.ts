import { Aggregate } from "../../objects/aggregate/aggregate.model.ts";
import { AlterAggregateChangeOwner } from "../../objects/aggregate/changes/aggregate.alter.ts";
import {
  CreateCommentOnAggregate,
  DropCommentOnAggregate,
} from "../../objects/aggregate/changes/aggregate.comment.ts";
// ── Aggregate changes ───────────────────────────────────────────────────────
import { CreateAggregate } from "../../objects/aggregate/changes/aggregate.create.ts";
import { DropAggregate } from "../../objects/aggregate/changes/aggregate.drop.ts";
import {
  GrantAggregatePrivileges,
  RevokeAggregatePrivileges,
  RevokeGrantOptionAggregatePrivileges,
} from "../../objects/aggregate/changes/aggregate.privilege.ts";
import type { ColumnProps } from "../../objects/base.model.ts";
import {
  AlterCollationChangeOwner,
  AlterCollationRefreshVersion,
} from "../../objects/collation/changes/collation.alter.ts";
import {
  CreateCommentOnCollation,
  DropCommentOnCollation,
} from "../../objects/collation/changes/collation.comment.ts";
// ── Collation changes ───────────────────────────────────────────────────────
import { CreateCollation } from "../../objects/collation/changes/collation.create.ts";
import { DropCollation } from "../../objects/collation/changes/collation.drop.ts";
// ── Models ──────────────────────────────────────────────────────────────────
import { Collation } from "../../objects/collation/collation.model.ts";
import {
  AlterDomainAddConstraint,
  AlterDomainChangeOwner,
  AlterDomainDropConstraint,
  AlterDomainDropDefault,
  AlterDomainDropNotNull,
  AlterDomainSetDefault,
  AlterDomainSetNotNull,
  AlterDomainValidateConstraint,
} from "../../objects/domain/changes/domain.alter.ts";
import {
  CreateCommentOnDomain,
  DropCommentOnDomain,
} from "../../objects/domain/changes/domain.comment.ts";
// ── Domain changes ──────────────────────────────────────────────────────────
import { CreateDomain } from "../../objects/domain/changes/domain.create.ts";
import { DropDomain } from "../../objects/domain/changes/domain.drop.ts";
import {
  GrantDomainPrivileges,
  RevokeDomainPrivileges,
  RevokeGrantOptionDomainPrivileges,
} from "../../objects/domain/changes/domain.privilege.ts";
import {
  Domain,
  type DomainConstraintProps,
} from "../../objects/domain/domain.model.ts";
import {
  AlterEventTriggerChangeOwner,
  AlterEventTriggerSetEnabled,
} from "../../objects/event-trigger/changes/event-trigger.alter.ts";
import {
  CreateCommentOnEventTrigger,
  DropCommentOnEventTrigger,
} from "../../objects/event-trigger/changes/event-trigger.comment.ts";
// ── Event Trigger changes ───────────────────────────────────────────────────
import { CreateEventTrigger } from "../../objects/event-trigger/changes/event-trigger.create.ts";
import { DropEventTrigger } from "../../objects/event-trigger/changes/event-trigger.drop.ts";
import { EventTrigger } from "../../objects/event-trigger/event-trigger.model.ts";
import {
  AlterExtensionSetSchema,
  AlterExtensionUpdateVersion,
} from "../../objects/extension/changes/extension.alter.ts";
import {
  CreateCommentOnExtension,
  DropCommentOnExtension,
} from "../../objects/extension/changes/extension.comment.ts";
// ── Extension changes ───────────────────────────────────────────────────────
import { CreateExtension } from "../../objects/extension/changes/extension.create.ts";
import { DropExtension } from "../../objects/extension/changes/extension.drop.ts";
import { Extension } from "../../objects/extension/extension.model.ts";
import {
  AlterForeignDataWrapperChangeOwner,
  AlterForeignDataWrapperSetOptions,
} from "../../objects/foreign-data-wrapper/foreign-data-wrapper/changes/foreign-data-wrapper.alter.ts";
import {
  CreateCommentOnForeignDataWrapper,
  DropCommentOnForeignDataWrapper,
} from "../../objects/foreign-data-wrapper/foreign-data-wrapper/changes/foreign-data-wrapper.comment.ts";
// ── Foreign Data Wrapper changes ────────────────────────────────────────────
import { CreateForeignDataWrapper } from "../../objects/foreign-data-wrapper/foreign-data-wrapper/changes/foreign-data-wrapper.create.ts";
import { DropForeignDataWrapper } from "../../objects/foreign-data-wrapper/foreign-data-wrapper/changes/foreign-data-wrapper.drop.ts";
import {
  GrantForeignDataWrapperPrivileges,
  RevokeForeignDataWrapperPrivileges,
  RevokeGrantOptionForeignDataWrapperPrivileges,
} from "../../objects/foreign-data-wrapper/foreign-data-wrapper/changes/foreign-data-wrapper.privilege.ts";
import { ForeignDataWrapper } from "../../objects/foreign-data-wrapper/foreign-data-wrapper/foreign-data-wrapper.model.ts";
import {
  AlterForeignTableAddColumn,
  AlterForeignTableAlterColumnDropDefault,
  AlterForeignTableAlterColumnDropNotNull,
  AlterForeignTableAlterColumnSetDefault,
  AlterForeignTableAlterColumnSetNotNull,
  AlterForeignTableAlterColumnType,
  AlterForeignTableChangeOwner,
  AlterForeignTableDropColumn,
  AlterForeignTableSetOptions,
} from "../../objects/foreign-data-wrapper/foreign-table/changes/foreign-table.alter.ts";
import {
  CreateCommentOnForeignTable,
  DropCommentOnForeignTable,
} from "../../objects/foreign-data-wrapper/foreign-table/changes/foreign-table.comment.ts";
// ── Foreign Table changes ───────────────────────────────────────────────────
import { CreateForeignTable } from "../../objects/foreign-data-wrapper/foreign-table/changes/foreign-table.create.ts";
import { DropForeignTable } from "../../objects/foreign-data-wrapper/foreign-table/changes/foreign-table.drop.ts";
import {
  GrantForeignTablePrivileges,
  RevokeForeignTablePrivileges,
  RevokeGrantOptionForeignTablePrivileges,
} from "../../objects/foreign-data-wrapper/foreign-table/changes/foreign-table.privilege.ts";
import { ForeignTable } from "../../objects/foreign-data-wrapper/foreign-table/foreign-table.model.ts";
import {
  AlterServerChangeOwner,
  AlterServerSetOptions,
  AlterServerSetVersion,
} from "../../objects/foreign-data-wrapper/server/changes/server.alter.ts";
import {
  CreateCommentOnServer,
  DropCommentOnServer,
} from "../../objects/foreign-data-wrapper/server/changes/server.comment.ts";
// ── Server changes ──────────────────────────────────────────────────────────
import { CreateServer } from "../../objects/foreign-data-wrapper/server/changes/server.create.ts";
import { DropServer } from "../../objects/foreign-data-wrapper/server/changes/server.drop.ts";
import {
  GrantServerPrivileges,
  RevokeGrantOptionServerPrivileges,
  RevokeServerPrivileges,
} from "../../objects/foreign-data-wrapper/server/changes/server.privilege.ts";
import { Server } from "../../objects/foreign-data-wrapper/server/server.model.ts";
import { AlterUserMappingSetOptions } from "../../objects/foreign-data-wrapper/user-mapping/changes/user-mapping.alter.ts";
// ── User Mapping changes ────────────────────────────────────────────────────
import { CreateUserMapping } from "../../objects/foreign-data-wrapper/user-mapping/changes/user-mapping.create.ts";
import { DropUserMapping } from "../../objects/foreign-data-wrapper/user-mapping/changes/user-mapping.drop.ts";
import { UserMapping } from "../../objects/foreign-data-wrapper/user-mapping/user-mapping.model.ts";
import {
  AlterIndexSetStatistics,
  AlterIndexSetStorageParams,
} from "../../objects/index/changes/index.alter.ts";
import {
  CreateCommentOnIndex,
  DropCommentOnIndex,
} from "../../objects/index/changes/index.comment.ts";
// ── Index changes ───────────────────────────────────────────────────────────
import { CreateIndex } from "../../objects/index/changes/index.create.ts";
import { DropIndex } from "../../objects/index/changes/index.drop.ts";
import { Index } from "../../objects/index/index.model.ts";
import { AlterLanguageChangeOwner } from "../../objects/language/changes/language.alter.ts";
import {
  CreateCommentOnLanguage,
  DropCommentOnLanguage,
} from "../../objects/language/changes/language.comment.ts";
// ── Language changes ────────────────────────────────────────────────────────
import { CreateLanguage } from "../../objects/language/changes/language.create.ts";
import { DropLanguage } from "../../objects/language/changes/language.drop.ts";
import {
  GrantLanguagePrivileges,
  RevokeGrantOptionLanguagePrivileges,
  RevokeLanguagePrivileges,
} from "../../objects/language/changes/language.privilege.ts";
import { Language } from "../../objects/language/language.model.ts";
import {
  AlterMaterializedViewChangeOwner,
  AlterMaterializedViewSetStorageParams,
} from "../../objects/materialized-view/changes/materialized-view.alter.ts";
import {
  CreateCommentOnMaterializedView,
  CreateCommentOnMaterializedViewColumn,
  DropCommentOnMaterializedView,
  DropCommentOnMaterializedViewColumn,
} from "../../objects/materialized-view/changes/materialized-view.comment.ts";
// ── Materialized View changes ───────────────────────────────────────────────
import { CreateMaterializedView } from "../../objects/materialized-view/changes/materialized-view.create.ts";
import { DropMaterializedView } from "../../objects/materialized-view/changes/materialized-view.drop.ts";
import {
  GrantMaterializedViewPrivileges,
  RevokeGrantOptionMaterializedViewPrivileges,
  RevokeMaterializedViewPrivileges,
} from "../../objects/materialized-view/changes/materialized-view.privilege.ts";
import { MaterializedView } from "../../objects/materialized-view/materialized-view.model.ts";
import {
  AlterProcedureChangeOwner,
  AlterProcedureSetConfig,
  AlterProcedureSetLeakproof,
  AlterProcedureSetParallel,
  AlterProcedureSetSecurity,
  AlterProcedureSetStrictness,
  AlterProcedureSetVolatility,
} from "../../objects/procedure/changes/procedure.alter.ts";
import {
  CreateCommentOnProcedure,
  DropCommentOnProcedure,
} from "../../objects/procedure/changes/procedure.comment.ts";

// ── Procedure / Function changes ────────────────────────────────────────────
import { CreateProcedure } from "../../objects/procedure/changes/procedure.create.ts";
import { DropProcedure } from "../../objects/procedure/changes/procedure.drop.ts";
import {
  GrantProcedurePrivileges,
  RevokeGrantOptionProcedurePrivileges,
  RevokeProcedurePrivileges,
} from "../../objects/procedure/changes/procedure.privilege.ts";
import { Procedure } from "../../objects/procedure/procedure.model.ts";
import {
  AlterPublicationAddSchemas,
  AlterPublicationAddTables,
  AlterPublicationDropSchemas,
  AlterPublicationDropTables,
  AlterPublicationSetForAllTables,
  AlterPublicationSetList,
  AlterPublicationSetOptions,
  AlterPublicationSetOwner,
} from "../../objects/publication/changes/publication.alter.ts";
import {
  CreateCommentOnPublication,
  DropCommentOnPublication,
} from "../../objects/publication/changes/publication.comment.ts";
// ── Publication changes ─────────────────────────────────────────────────────
import { CreatePublication } from "../../objects/publication/changes/publication.create.ts";
import { DropPublication } from "../../objects/publication/changes/publication.drop.ts";
import { Publication } from "../../objects/publication/publication.model.ts";
import {
  AlterRlsPolicySetRoles,
  AlterRlsPolicySetUsingExpression,
  AlterRlsPolicySetWithCheckExpression,
} from "../../objects/rls-policy/changes/rls-policy.alter.ts";
import {
  CreateCommentOnRlsPolicy,
  DropCommentOnRlsPolicy,
} from "../../objects/rls-policy/changes/rls-policy.comment.ts";
// ── RLS Policy changes ──────────────────────────────────────────────────────
import { CreateRlsPolicy } from "../../objects/rls-policy/changes/rls-policy.create.ts";
import { DropRlsPolicy } from "../../objects/rls-policy/changes/rls-policy.drop.ts";
import { RlsPolicy } from "../../objects/rls-policy/rls-policy.model.ts";
import {
  AlterRoleSetConfig,
  AlterRoleSetOptions,
} from "../../objects/role/changes/role.alter.ts";
import {
  CreateCommentOnRole,
  DropCommentOnRole,
} from "../../objects/role/changes/role.comment.ts";
// ── Role changes ────────────────────────────────────────────────────────────
import { CreateRole } from "../../objects/role/changes/role.create.ts";
import { DropRole } from "../../objects/role/changes/role.drop.ts";
import {
  GrantRoleDefaultPrivileges,
  GrantRoleMembership,
  RevokeRoleDefaultPrivileges,
  RevokeRoleMembership,
  RevokeRoleMembershipOptions,
} from "../../objects/role/changes/role.privilege.ts";
import { Role } from "../../objects/role/role.model.ts";
import {
  ReplaceRule,
  SetRuleEnabledState,
} from "../../objects/rule/changes/rule.alter.ts";
import {
  CreateCommentOnRule,
  DropCommentOnRule,
} from "../../objects/rule/changes/rule.comment.ts";
// ── Rule changes ────────────────────────────────────────────────────────────
import { CreateRule } from "../../objects/rule/changes/rule.create.ts";
import { DropRule } from "../../objects/rule/changes/rule.drop.ts";
import { Rule } from "../../objects/rule/rule.model.ts";
import { AlterSchemaChangeOwner } from "../../objects/schema/changes/schema.alter.ts";
import {
  CreateCommentOnSchema,
  DropCommentOnSchema,
} from "../../objects/schema/changes/schema.comment.ts";
// ── Schema changes ──────────────────────────────────────────────────────────
import { CreateSchema } from "../../objects/schema/changes/schema.create.ts";
import { DropSchema } from "../../objects/schema/changes/schema.drop.ts";
import {
  GrantSchemaPrivileges,
  RevokeGrantOptionSchemaPrivileges,
  RevokeSchemaPrivileges,
} from "../../objects/schema/changes/schema.privilege.ts";
import { Schema } from "../../objects/schema/schema.model.ts";
import {
  AlterSequenceSetOptions,
  AlterSequenceSetOwnedBy,
} from "../../objects/sequence/changes/sequence.alter.ts";
import {
  CreateCommentOnSequence,
  DropCommentOnSequence,
} from "../../objects/sequence/changes/sequence.comment.ts";
// ── Sequence changes ────────────────────────────────────────────────────────
import { CreateSequence } from "../../objects/sequence/changes/sequence.create.ts";
import { DropSequence } from "../../objects/sequence/changes/sequence.drop.ts";
import {
  GrantSequencePrivileges,
  RevokeGrantOptionSequencePrivileges,
  RevokeSequencePrivileges,
} from "../../objects/sequence/changes/sequence.privilege.ts";
import { Sequence } from "../../objects/sequence/sequence.model.ts";
import {
  AlterSubscriptionDisable,
  AlterSubscriptionEnable,
  AlterSubscriptionSetConnection,
  AlterSubscriptionSetOptions,
  AlterSubscriptionSetOwner,
  AlterSubscriptionSetPublication,
} from "../../objects/subscription/changes/subscription.alter.ts";
import {
  CreateCommentOnSubscription,
  DropCommentOnSubscription,
} from "../../objects/subscription/changes/subscription.comment.ts";
// ── Subscription changes ────────────────────────────────────────────────────
import { CreateSubscription } from "../../objects/subscription/changes/subscription.create.ts";
import { DropSubscription } from "../../objects/subscription/changes/subscription.drop.ts";
import { Subscription } from "../../objects/subscription/subscription.model.ts";
import {
  AlterTableAddColumn,
  AlterTableAddConstraint,
  AlterTableAlterColumnDropDefault,
  AlterTableAlterColumnDropNotNull,
  AlterTableAlterColumnSetDefault,
  AlterTableAlterColumnSetNotNull,
  AlterTableAlterColumnType,
  AlterTableAttachPartition,
  AlterTableChangeOwner,
  AlterTableDetachPartition,
  AlterTableDisableRowLevelSecurity,
  AlterTableDropColumn,
  AlterTableDropConstraint,
  AlterTableEnableRowLevelSecurity,
  AlterTableForceRowLevelSecurity,
  AlterTableNoForceRowLevelSecurity,
  AlterTableResetStorageParams,
  AlterTableSetLogged,
  AlterTableSetReplicaIdentity,
  AlterTableSetStorageParams,
  AlterTableSetUnlogged,
  AlterTableValidateConstraint,
} from "../../objects/table/changes/table.alter.ts";
import {
  CreateCommentOnColumn,
  CreateCommentOnConstraint,
  CreateCommentOnTable,
  DropCommentOnColumn,
  DropCommentOnConstraint,
  DropCommentOnTable,
} from "../../objects/table/changes/table.comment.ts";
// ── Table changes ───────────────────────────────────────────────────────────
import { CreateTable } from "../../objects/table/changes/table.create.ts";
import { DropTable } from "../../objects/table/changes/table.drop.ts";
import {
  GrantTablePrivileges,
  RevokeGrantOptionTablePrivileges,
  RevokeTablePrivileges,
} from "../../objects/table/changes/table.privilege.ts";
import { Table } from "../../objects/table/table.model.ts";
import { ReplaceTrigger } from "../../objects/trigger/changes/trigger.alter.ts";
import {
  CreateCommentOnTrigger,
  DropCommentOnTrigger,
} from "../../objects/trigger/changes/trigger.comment.ts";
// ── Trigger changes ─────────────────────────────────────────────────────────
import { CreateTrigger } from "../../objects/trigger/changes/trigger.create.ts";
import { DropTrigger } from "../../objects/trigger/changes/trigger.drop.ts";
import { Trigger } from "../../objects/trigger/trigger.model.ts";
import {
  AlterCompositeTypeAddAttribute,
  AlterCompositeTypeAlterAttributeType,
  AlterCompositeTypeChangeOwner,
  AlterCompositeTypeDropAttribute,
} from "../../objects/type/composite-type/changes/composite-type.alter.ts";
import {
  CreateCommentOnCompositeType,
  CreateCommentOnCompositeTypeAttribute,
  DropCommentOnCompositeType,
  DropCommentOnCompositeTypeAttribute,
} from "../../objects/type/composite-type/changes/composite-type.comment.ts";
// ── Composite type changes ──────────────────────────────────────────────────
import { CreateCompositeType } from "../../objects/type/composite-type/changes/composite-type.create.ts";
import { DropCompositeType } from "../../objects/type/composite-type/changes/composite-type.drop.ts";
import {
  GrantCompositeTypePrivileges,
  RevokeCompositeTypePrivileges,
  RevokeGrantOptionCompositeTypePrivileges,
} from "../../objects/type/composite-type/changes/composite-type.privilege.ts";
import { CompositeType } from "../../objects/type/composite-type/composite-type.model.ts";
import {
  AlterEnumAddValue,
  AlterEnumChangeOwner,
} from "../../objects/type/enum/changes/enum.alter.ts";
import {
  CreateCommentOnEnum,
  DropCommentOnEnum,
} from "../../objects/type/enum/changes/enum.comment.ts";
// ── Enum changes ────────────────────────────────────────────────────────────
import { CreateEnum } from "../../objects/type/enum/changes/enum.create.ts";
import { DropEnum } from "../../objects/type/enum/changes/enum.drop.ts";
import {
  GrantEnumPrivileges,
  RevokeEnumPrivileges,
  RevokeGrantOptionEnumPrivileges,
} from "../../objects/type/enum/changes/enum.privilege.ts";
import { Enum } from "../../objects/type/enum/enum.model.ts";
import { AlterRangeChangeOwner } from "../../objects/type/range/changes/range.alter.ts";
import {
  CreateCommentOnRange,
  DropCommentOnRange,
} from "../../objects/type/range/changes/range.comment.ts";
// ── Range changes ───────────────────────────────────────────────────────────
import { CreateRange } from "../../objects/type/range/changes/range.create.ts";
import { DropRange } from "../../objects/type/range/changes/range.drop.ts";
import {
  GrantRangePrivileges,
  RevokeGrantOptionRangePrivileges,
  RevokeRangePrivileges,
} from "../../objects/type/range/changes/range.privilege.ts";
import { Range } from "../../objects/type/range/range.model.ts";
import {
  AlterViewChangeOwner,
  AlterViewResetOptions,
  AlterViewSetOptions,
} from "../../objects/view/changes/view.alter.ts";
import {
  CreateCommentOnView,
  DropCommentOnView,
} from "../../objects/view/changes/view.comment.ts";
// ── View changes ────────────────────────────────────────────────────────────
import { CreateView } from "../../objects/view/changes/view.create.ts";
import { DropView } from "../../objects/view/changes/view.drop.ts";
import {
  GrantViewPrivileges,
  RevokeGrantOptionViewPrivileges,
  RevokeViewPrivileges,
} from "../../objects/view/changes/view.privilege.ts";
import { View } from "../../objects/view/view.model.ts";
import type { SqlFormatOptions } from "../sql-format.ts";
import { formatSqlScript } from "../statements.ts";

// ── Helpers ─────────────────────────────────────────────────────────────────

type ChangeCase = {
  label: string;
  change: { serialize: () => string };
};

const column = (overrides: Partial<ColumnProps> = {}): ColumnProps => ({
  name: "id",
  position: 1,
  data_type: "integer",
  data_type_str: "integer",
  is_custom_type: false,
  custom_type_type: null,
  custom_type_category: null,
  custom_type_schema: null,
  custom_type_name: null,
  not_null: false,
  is_identity: false,
  is_identity_always: false,
  is_generated: false,
  collation: null,
  default: null,
  comment: null,
  ...overrides,
});

// ── Model objects ───────────────────────────────────────────────────────────

const domainConstraint: DomainConstraintProps = {
  name: "domain_chk",
  validated: true,
  is_local: true,
  no_inherit: false,
  check_expression: "VALUE <> ''",
};

const domainConstraint2: DomainConstraintProps = {
  name: "domain_len_chk",
  validated: false,
  is_local: true,
  no_inherit: true,
  check_expression: "char_length(VALUE) <= 255",
};

const domain = new Domain({
  schema: "public",
  name: "test_domain_all",
  base_type: "text",
  base_type_schema: "custom",
  base_type_str: "text",
  not_null: true,
  type_modifier: null,
  array_dimensions: 2,
  collation: "mycoll",
  default_bin: null,
  default_value: "'hello'",
  owner: "test",
  comment: "domain comment",
  constraints: [domainConstraint],
  privileges: [],
});

const enumType = new Enum({
  schema: "public",
  name: "test_enum",
  owner: "test",
  labels: [
    { sort_order: 1, label: "value1" },
    { sort_order: 2, label: "value2" },
    { sort_order: 3, label: "value3" },
  ],
  comment: "enum comment",
  privileges: [],
});

const compositeType = new CompositeType({
  schema: "public",
  name: "test_type",
  row_security: false,
  force_row_security: false,
  has_indexes: false,
  has_rules: false,
  has_triggers: false,
  has_subclasses: false,
  is_populated: false,
  replica_identity: "d",
  is_partition: false,
  options: null,
  partition_bound: null,
  owner: "test",
  comment: "composite comment",
  columns: [
    column({ name: "id", data_type_str: "integer", comment: "attr comment" }),
    column({ name: "name", data_type_str: "text", collation: '"en_US"' }),
  ],
  privileges: [],
});

const rangeType = new Range({
  schema: "public",
  name: "daterange_custom",
  owner: "owner1",
  subtype_schema: "pg_catalog",
  subtype_str: "date",
  collation: '"en_US"',
  canonical_function_schema: "public",
  canonical_function_name: "canon_fn",
  subtype_diff_schema: "public",
  subtype_diff_name: "diff_fn",
  subtype_opclass_schema: "public",
  subtype_opclass_name: "date_ops",
  comment: "range comment",
  privileges: [],
});

const collation = new Collation({
  schema: "public",
  name: "test",
  provider: "i",
  is_deterministic: false,
  encoding: 1,
  collate: "en_US",
  locale: "en_US",
  version: "1.0",
  ctype: "en_US",
  icu_rules: "& A < a <<< à",
  owner: "owner",
  comment: "collation comment",
});

const pkConstraint = {
  name: "pk_t_fmt",
  constraint_type: "p" as const,
  deferrable: false,
  initially_deferred: false,
  validated: true,
  is_local: true,
  no_inherit: false,
  is_partition_clone: false,
  parent_constraint_schema: null,
  parent_constraint_name: null,
  parent_table_schema: null,
  parent_table_name: null,
  key_columns: ["id"],
  foreign_key_columns: null,
  foreign_key_table: null,
  foreign_key_schema: null,
  foreign_key_table_is_partition: null,
  foreign_key_parent_schema: null,
  foreign_key_parent_table: null,
  foreign_key_effective_schema: null,
  foreign_key_effective_table: null,
  on_update: null,
  on_delete: null,
  match_type: null,
  check_expression: null,
  owner: "owner1",
  definition: "PRIMARY KEY (id)",
  comment: "primary key",
};

const uniqueConstraint = {
  name: "uq_t_fmt_status",
  constraint_type: "u" as const,
  deferrable: false,
  initially_deferred: false,
  validated: true,
  is_local: true,
  no_inherit: false,
  is_partition_clone: false,
  parent_constraint_schema: null,
  parent_constraint_name: null,
  parent_table_schema: null,
  parent_table_name: null,
  key_columns: ["status"],
  foreign_key_columns: null,
  foreign_key_table: null,
  foreign_key_schema: null,
  foreign_key_table_is_partition: null,
  foreign_key_parent_schema: null,
  foreign_key_parent_table: null,
  foreign_key_effective_schema: null,
  foreign_key_effective_table: null,
  on_update: null,
  on_delete: null,
  match_type: null,
  check_expression: null,
  owner: "owner1",
  definition: "UNIQUE (status)",
};

const fkConstraint = {
  name: "fk_t_fmt_ref",
  constraint_type: "f" as const,
  deferrable: true,
  initially_deferred: true,
  validated: true,
  is_local: true,
  no_inherit: false,
  is_partition_clone: false,
  parent_constraint_schema: null,
  parent_constraint_name: null,
  parent_table_schema: null,
  parent_table_name: null,
  key_columns: ["ref_id"],
  foreign_key_columns: ["id"],
  foreign_key_table: "other_table",
  foreign_key_schema: "public",
  foreign_key_table_is_partition: false,
  foreign_key_parent_schema: null,
  foreign_key_parent_table: null,
  foreign_key_effective_schema: "public",
  foreign_key_effective_table: "other_table",
  on_update: "n" as const,
  on_delete: "c" as const,
  match_type: "f" as const,
  check_expression: null,
  owner: "owner1",
  definition:
    "FOREIGN KEY (ref_id) REFERENCES public.other_table(id) MATCH FULL ON UPDATE SET NULL ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED",
};

const checkConstraint = {
  name: "chk_t_fmt_status",
  constraint_type: "c" as const,
  deferrable: false,
  initially_deferred: false,
  validated: true,
  is_local: true,
  no_inherit: true,
  is_partition_clone: false,
  parent_constraint_schema: null,
  parent_constraint_name: null,
  parent_table_schema: null,
  parent_table_name: null,
  key_columns: [] as string[],
  foreign_key_columns: null,
  foreign_key_table: null,
  foreign_key_schema: null,
  foreign_key_table_is_partition: null,
  foreign_key_parent_schema: null,
  foreign_key_parent_table: null,
  foreign_key_effective_schema: null,
  foreign_key_effective_table: null,
  on_update: null,
  on_delete: null,
  match_type: null,
  check_expression: "status <> '' AND created_at > '2020-01-01'::timestamptz",
  owner: "owner1",
  definition:
    "CHECK (status <> '' AND created_at > '2020-01-01'::timestamptz) NO INHERIT",
  comment: "check constraint comment",
};

const table = new Table({
  schema: "public",
  name: "table_with_very_long_name_for_formatting_and_wrapping_test",
  persistence: "p",
  row_security: false,
  force_row_security: false,
  has_indexes: false,
  has_rules: false,
  has_triggers: false,
  has_subclasses: false,
  is_populated: true,
  replica_identity: "d",
  is_partition: false,
  options: ["fillfactor=70", "autovacuum_enabled=false"],
  partition_bound: null,
  partition_by: null,
  owner: "owner1",
  comment: "table comment",
  parent_schema: null,
  parent_name: null,
  columns: [
    column({
      name: "id",
      data_type: "bigint",
      data_type_str: "bigint",
      not_null: true,
      is_identity: true,
      is_identity_always: true,
      comment: "id column",
    }),
    column({
      name: "status",
      data_type: "text",
      data_type_str: "text",
      default: "'pending'",
      collation: '"en_US"',
      comment: "status column",
    }),
    column({
      name: "created_at",
      data_type: "timestamptz",
      data_type_str: "timestamptz",
      default: "now()",
    }),
    column({
      name: "ref_id",
      data_type: "bigint",
      data_type_str: "bigint",
    }),
    column({
      name: "computed",
      data_type: "bigint",
      data_type_str: "bigint",
      is_generated: true,
      default: "id * 2",
    }),
  ],
  constraints: [pkConstraint, uniqueConstraint, fkConstraint, checkConstraint],
  privileges: [],
});

const partitionedTable = new Table({
  schema: "public",
  name: "events",
  persistence: "p",
  row_security: false,
  force_row_security: false,
  has_indexes: false,
  has_rules: false,
  has_triggers: false,
  has_subclasses: true,
  is_populated: true,
  replica_identity: "d",
  is_partition: false,
  options: null,
  partition_bound: null,
  partition_by: "RANGE (created_at)",
  owner: "owner1",
  comment: null,
  parent_schema: null,
  parent_name: null,
  columns: [
    column({
      name: "id",
      data_type: "bigint",
      data_type_str: "bigint",
      not_null: true,
    }),
    column({
      name: "created_at",
      data_type: "timestamptz",
      data_type_str: "timestamptz",
      not_null: true,
    }),
  ],
  constraints: [],
  privileges: [],
});

const partitionChild = new Table({
  schema: "public",
  name: "events_2024",
  persistence: "p",
  row_security: false,
  force_row_security: false,
  has_indexes: false,
  has_rules: false,
  has_triggers: false,
  has_subclasses: false,
  is_populated: true,
  replica_identity: "d",
  is_partition: true,
  options: null,
  partition_bound: "FOR VALUES FROM ('2024-01-01') TO ('2025-01-01')",
  partition_by: null,
  owner: "owner1",
  comment: null,
  parent_schema: "public",
  parent_name: "events",
  columns: [
    column({
      name: "id",
      data_type: "bigint",
      data_type_str: "bigint",
      not_null: true,
    }),
    column({
      name: "created_at",
      data_type: "timestamptz",
      data_type_str: "timestamptz",
      not_null: true,
    }),
  ],
  constraints: [],
  privileges: [],
});

const publication = new Publication({
  name: "pub_custom",
  owner: "owner1",
  comment: "publication comment",
  all_tables: false,
  publish_insert: true,
  publish_update: true,
  publish_delete: true,
  publish_truncate: true,
  publish_via_partition_root: false,
  tables: [
    {
      schema: "public",
      name: "articles_with_a_very_long_name_very_very_long_name_that_will_go_above_the_wrapping_limit",
      columns: ["id", "title"],
      row_filter: "(published = true)",
    },
    {
      schema: "public",
      name: "comments_a_little_smaller_name_than_the_previous_one",
      columns: null,
      row_filter: null,
    },
  ],
  schemas: ["analytics"],
});

const view = new View({
  schema: "public",
  name: "test_view",
  definition: "SELECT *\nFROM test_table",
  row_security: false,
  force_row_security: false,
  has_indexes: false,
  has_rules: false,
  has_triggers: false,
  has_subclasses: false,
  is_populated: false,
  replica_identity: "d",
  is_partition: false,
  options: ["security_barrier=true", "check_option=local"],
  partition_bound: null,
  owner: "test",
  comment: "view comment",
  columns: [],
  privileges: [],
});

const rule = new Rule({
  schema: "public",
  table_name: "test_table",
  name: "test_rule",
  relation_kind: "r",
  event: "INSERT",
  enabled: "O",
  is_instead: true,
  definition:
    "CREATE RULE test_rule AS ON INSERT TO public.test_table DO INSTEAD NOTHING",
  columns: [],
  comment: "rule comment",
  owner: "test",
});

const procedure = new Procedure({
  schema: "public",
  name: "test_procedure",
  kind: "p",
  return_type: "void",
  return_type_schema: "pg_catalog",
  language: "plpgsql",
  security_definer: false,
  volatility: "v",
  parallel_safety: "u",
  execution_cost: 0,
  result_rows: 0,
  is_strict: false,
  leakproof: false,
  returns_set: false,
  argument_count: 0,
  argument_default_count: 0,
  argument_names: null,
  argument_types: null,
  all_argument_types: null,
  argument_modes: null,
  argument_defaults: null,
  source_code: "BEGIN RETURN; END;",
  binary_path: null,
  sql_body: null,
  owner: "test",
  comment: "procedure comment",
  privileges: [],
  definition:
    "CREATE PROCEDURE public.test_procedure() LANGUAGE plpgsql AS $$ begin null; end; $$",
  config: null,
});

const complexFunction = new Procedure({
  schema: "public",
  name: "calculate_metrics_for_analytics_dashboard_with_extended_name",
  kind: "f",
  return_type: "TABLE(total bigint, average numeric)",
  return_type_schema: "pg_catalog",
  language: "plpgsql",
  security_definer: true,
  volatility: "s",
  parallel_safety: "s",
  execution_cost: 100,
  result_rows: 10,
  is_strict: true,
  leakproof: false,
  returns_set: true,
  argument_count: 3,
  argument_default_count: 1,
  argument_names: [
    '"p_schema_name_for_analytics"',
    '"p_table_name_for_metrics"',
    '"p_limit_count_default"',
  ],
  argument_types: ["text", "text", "integer"],
  all_argument_types: ["text", "text", "integer"],
  argument_modes: ["i", "i", "i"],
  argument_defaults: "100",
  source_code:
    "BEGIN\n  RETURN QUERY SELECT count(*)::bigint, avg(value)::numeric FROM ...\nEND;",
  binary_path: null,
  sql_body: null,
  owner: "admin",
  comment: "Calculate metrics for a given table",
  privileges: [],
  definition:
    'CREATE OR REPLACE FUNCTION public.calculate_metrics_for_analytics_dashboard_with_extended_name("p_schema_name_for_analytics" text, "p_table_name_for_metrics" text, "p_limit_count_default" integer DEFAULT 100) RETURNS TABLE(total bigint, average numeric) LANGUAGE plpgsql STABLE SECURITY DEFINER PARALLEL SAFE COST 100 ROWS 10 STRICT SET search_path TO \'pg_catalog\', \'public\' AS $function$ BEGIN RETURN QUERY SELECT count(*)::bigint, avg(value)::numeric FROM generate_series(1, p_limit_count_default); END; $function$',
  config: ["search_path TO 'pg_catalog', 'public'"],
});

const sequence = new Sequence({
  schema: "public",
  name: "table_with_very_long_name_for_formatting_and_wrapping_test_id_seq",
  data_type: "bigint",
  start_value: 1,
  minimum_value: BigInt(1),
  maximum_value: BigInt("9223372036854775807"),
  increment: 1,
  cycle_option: false,
  cache_size: 1,
  persistence: "p",
  owned_by_schema: "public",
  owned_by_table: "table_with_very_long_name_for_formatting_and_wrapping_test",
  owned_by_column: "id",
  comment:
    "sequence for table_with_very_long_name_for_formatting_and_wrapping_test.id",
  privileges: [],
  owner: "owner1",
});

const rlsPolicy = new RlsPolicy({
  schema: "public",
  name: "allow_select_own",
  table_name: "table_with_very_long_name_for_formatting_and_wrapping_test",
  command: "r",
  permissive: true,
  roles: ["authenticated"],
  using_expression: "auth.uid() = user_id",
  with_check_expression: null,
  owner: "owner1",
  comment: "rls policy comment",
});

const rlsPolicyRestrictive = new RlsPolicy({
  schema: "public",
  name: "restrict_delete",
  table_name: "table_with_very_long_name_for_formatting_and_wrapping_test",
  command: "d",
  permissive: false,
  roles: ["authenticated", "service_role"],
  using_expression: "auth.uid() = owner_id",
  with_check_expression: "status <> 'locked'",
  owner: "owner1",
  comment: null,
});

const index = new Index({
  schema: "public",
  table_name: "table_with_very_long_name_for_formatting_and_wrapping_test",
  name: "idx_t_fmt_status",
  storage_params: ["fillfactor=90"],
  statistics_target: [100],
  index_type: "btree",
  tablespace: null,
  is_unique: true,
  is_primary: false,
  is_exclusion: false,
  nulls_not_distinct: false,
  immediate: true,
  is_clustered: false,
  is_replica_identity: false,
  key_columns: [2],
  column_collations: [null],
  operator_classes: ["default"],
  column_options: [0],
  index_expressions: null,
  partial_predicate: "status <> 'archived'",
  is_owned_by_constraint: false,
  table_relkind: "r",
  is_partitioned_index: false,
  is_index_partition: false,
  parent_index_name: null,
  definition:
    "CREATE UNIQUE INDEX idx_t_fmt_status ON public.table_with_very_long_name_for_formatting_and_wrapping_test USING btree (status) WITH (fillfactor='90') WHERE (status <> 'archived'::text)",
  comment: "index comment",
  owner: "owner1",
});

const ginIndex = new Index({
  schema: "public",
  table_name: "table_with_very_long_name_for_formatting_and_wrapping_test",
  name: "idx_t_fmt_search",
  storage_params: [],
  statistics_target: [],
  index_type: "gin",
  tablespace: null,
  is_unique: false,
  is_primary: false,
  is_exclusion: false,
  nulls_not_distinct: false,
  immediate: true,
  is_clustered: false,
  is_replica_identity: false,
  key_columns: [],
  column_collations: [],
  operator_classes: [],
  column_options: [],
  index_expressions: "to_tsvector('english', status)",
  partial_predicate: null,
  is_owned_by_constraint: false,
  table_relkind: "r",
  is_partitioned_index: false,
  is_index_partition: false,
  parent_index_name: null,
  definition:
    "CREATE INDEX idx_t_fmt_search ON public.table_with_very_long_name_for_formatting_and_wrapping_test USING gin (to_tsvector('english'::regconfig, status))",
  comment: null,
  owner: "owner1",
});

const trigger = new Trigger({
  schema: "public",
  name: "trg_audit",
  table_name: "table_with_very_long_name_for_formatting_and_wrapping_test",
  function_schema: "public",
  function_name: "audit_trigger_fn",
  trigger_type: 7,
  enabled: "O",
  is_internal: false,
  deferrable: true,
  initially_deferred: true,
  argument_count: 2,
  column_numbers: null,
  arguments: ["arg1", "arg2"],
  when_condition: "(NEW.status IS DISTINCT FROM OLD.status)",
  old_table: "old_rows",
  new_table: "new_rows",
  is_partition_clone: false,
  parent_trigger_name: null,
  parent_table_schema: null,
  parent_table_name: null,
  is_on_partitioned_table: false,
  owner: "owner1",
  definition:
    "CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE ON public.table_with_very_long_name_for_formatting_and_wrapping_test REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH ROW WHEN ((NEW.status IS DISTINCT FROM OLD.status)) EXECUTE FUNCTION public.audit_trigger_fn('arg1', 'arg2')",
  comment: "trigger comment",
});

// ── New object models ───────────────────────────────────────────────────────

const schema = new Schema({
  name: "application_schema_with_very_long_name_for_wrapping_tests",
  owner: "admin",
  comment: "application schema",
  privileges: [],
});

const extension = new Extension({
  name: "pgcrypto",
  schema: "extensions",
  relocatable: true,
  version: "1.3",
  owner: "postgres",
  comment: "cryptographic functions",
  members: [],
});

const materializedView = new MaterializedView({
  schema: "analytics",
  name: "daily_stats",
  definition:
    "SELECT date_trunc('day', created_at) AS day, count(*) AS total\nFROM public.events\nGROUP BY 1",
  row_security: false,
  force_row_security: false,
  has_indexes: false,
  has_rules: false,
  has_triggers: false,
  has_subclasses: false,
  is_populated: true,
  replica_identity: "d",
  is_partition: false,
  options: ["fillfactor=70"],
  partition_bound: null,
  owner: "admin",
  comment: "daily aggregation",
  columns: [
    column({
      name: "day",
      data_type: "timestamptz",
      data_type_str: "timestamptz",
      comment: "day bucket",
    }),
    column({
      name: "total",
      position: 2,
      data_type: "bigint",
      data_type_str: "bigint",
    }),
  ],
  privileges: [],
});

const aggregate = new Aggregate({
  schema: "public",
  name: "array_cat_agg",
  identity_arguments: "anycompatiblearray",
  kind: "a",
  aggkind: "n",
  num_direct_args: 0,
  return_type: "anycompatiblearray",
  return_type_schema: "pg_catalog",
  parallel_safety: "s",
  is_strict: true,
  transition_function: "array_cat(anycompatiblearray,anycompatiblearray)",
  state_data_type: "anycompatiblearray",
  state_data_type_schema: "pg_catalog",
  state_data_space: 0,
  final_function: null,
  final_function_extra_args: false,
  final_function_modify: null,
  combine_function: "array_cat(anycompatiblearray,anycompatiblearray)",
  serial_function: null,
  deserial_function: null,
  initial_condition: "{}",
  moving_transition_function: null,
  moving_inverse_function: null,
  moving_state_data_type: null,
  moving_state_data_type_schema: null,
  moving_state_data_space: null,
  moving_final_function: null,
  moving_final_function_extra_args: false,
  moving_final_function_modify: null,
  moving_initial_condition: null,
  sort_operator: null,
  argument_count: 1,
  argument_default_count: 0,
  argument_names: null,
  argument_types: ["anycompatiblearray"],
  all_argument_types: null,
  argument_modes: null,
  argument_defaults: null,
  owner: "postgres",
  comment: "concatenate arrays aggregate",
  privileges: [],
});

const eventTrigger = new EventTrigger({
  name: "prevent_drop",
  event: "sql_drop",
  function_schema: "public",
  function_name: "prevent_drop_fn",
  enabled: "O",
  tags: ["DROP TABLE", "DROP SCHEMA"],
  owner: "postgres",
  comment: "prevent accidental drops",
});

const language = new Language({
  name: "plv8",
  is_trusted: true,
  is_procedural: true,
  call_handler: "plv8_call_handler",
  inline_handler: "plv8_inline_handler",
  validator: "plv8_call_validator",
  owner: "postgres",
  comment: "PL/V8 trusted procedural language",
  privileges: [],
});

const role = new Role({
  name: "app_user",
  is_superuser: false,
  can_inherit: true,
  can_create_roles: false,
  can_create_databases: false,
  can_login: true,
  can_replicate: false,
  connection_limit: 100,
  can_bypass_rls: false,
  config: ["statement_timeout=30000", "search_path=public,app_schema"],
  comment: "application user role",
  members: [
    {
      member: "dev_user",
      grantor: "postgres",
      admin_option: true,
      inherit_option: true,
      set_option: true,
    },
  ],
  default_privileges: [
    {
      in_schema: "public",
      objtype: "r",
      grantee: "app_reader",
      privileges: [{ privilege: "SELECT", grantable: false }],
    },
  ],
});

const subscription = new Subscription({
  name: "sub_replica",
  raw_name: "sub_replica",
  owner: "postgres",
  comment: "replication subscription",
  enabled: true,
  binary: true,
  streaming: "parallel",
  two_phase: false,
  disable_on_error: true,
  password_required: true,
  run_as_owner: false,
  failover: true,
  conninfo: "host=primary.db port=5432 dbname=mydb",
  slot_name: "sub_replica_slot",
  slot_is_none: false,
  replication_slot_created: true,
  synchronous_commit: "remote_apply",
  publications: ["pub_custom"],
  origin: "any",
});

const foreignDataWrapper = new ForeignDataWrapper({
  name: "postgres_fdw",
  owner: "postgres",
  handler: "postgres_fdw_handler",
  validator: "postgres_fdw_validator",
  options: ["debug", "true"],
  comment: "PostgreSQL foreign data wrapper",
  privileges: [],
});

const foreignTable = new ForeignTable({
  schema: "public",
  name: "remote_users",
  owner: "postgres",
  server: "remote_server",
  options: ["schema_name", "public", "table_name", "users"],
  comment: "remote users table",
  columns: [
    column({
      name: "id",
      data_type: "integer",
      data_type_str: "integer",
      not_null: true,
    }),
    column({
      name: "email",
      data_type: "text",
      data_type_str: "text",
      position: 2,
    }),
  ],
  privileges: [],
});

const server = new Server({
  name: "remote_server",
  owner: "postgres",
  foreign_data_wrapper: "postgres_fdw",
  type: "postgresql",
  version: "16.0",
  options: ["host", "remote.host", "port", "5432", "dbname", "remote_db"],
  comment: "remote PostgreSQL server",
  privileges: [],
});

const userMapping = new UserMapping({
  user: "app_user",
  server: "remote_server",
  options: ["user", "remote_app", "password", "secret123"],
});

// ── Change cases ────────────────────────────────────────────────────────────

const changeCases: ChangeCase[] = [
  // ── Schema ──
  { label: "schema.create", change: new CreateSchema({ schema }) },
  { label: "schema.drop", change: new DropSchema({ schema }) },
  {
    label: "schema.alter.change_owner",
    change: new AlterSchemaChangeOwner({ schema, owner: "new_admin" }),
  },
  { label: "schema.comment", change: new CreateCommentOnSchema({ schema }) },
  { label: "schema.drop_comment", change: new DropCommentOnSchema({ schema }) },
  {
    label: "schema.grant",
    change: new GrantSchemaPrivileges({
      schema,
      grantee: "app_user",
      privileges: [
        { privilege: "USAGE", grantable: true },
        { privilege: "CREATE", grantable: true },
      ],
    }),
  },
  {
    label: "schema.revoke",
    change: new RevokeSchemaPrivileges({
      schema,
      grantee: "app_user",
      privileges: [{ privilege: "CREATE", grantable: false }],
    }),
  },
  {
    label: "schema.revoke_grant_option",
    change: new RevokeGrantOptionSchemaPrivileges({
      schema,
      grantee: "app_user",
      privilegeNames: ["USAGE"],
    }),
  },

  // ── Extension ──
  { label: "extension.create", change: new CreateExtension({ extension }) },
  { label: "extension.drop", change: new DropExtension({ extension }) },
  {
    label: "extension.alter.update_version",
    change: new AlterExtensionUpdateVersion({ extension, version: "1.4" }),
  },
  {
    label: "extension.alter.set_schema",
    change: new AlterExtensionSetSchema({ extension, schema: "public" }),
  },
  {
    label: "extension.comment",
    change: new CreateCommentOnExtension({ extension }),
  },
  {
    label: "extension.drop_comment",
    change: new DropCommentOnExtension({ extension }),
  },

  // ── Domain ──
  { label: "domain.create", change: new CreateDomain({ domain }) },
  { label: "domain.drop", change: new DropDomain({ domain }) },
  {
    label: "domain.alter.set_default",
    change: new AlterDomainSetDefault({ domain, defaultValue: "'world'" }),
  },
  {
    label: "domain.alter.drop_default",
    change: new AlterDomainDropDefault({ domain }),
  },
  {
    label: "domain.alter.set_not_null",
    change: new AlterDomainSetNotNull({ domain }),
  },
  {
    label: "domain.alter.drop_not_null",
    change: new AlterDomainDropNotNull({ domain }),
  },
  {
    label: "domain.alter.change_owner",
    change: new AlterDomainChangeOwner({ domain, owner: "new_owner" }),
  },
  {
    label: "domain.alter.add_constraint",
    change: new AlterDomainAddConstraint({
      domain,
      constraint: domainConstraint2,
    }),
  },
  {
    label: "domain.alter.drop_constraint",
    change: new AlterDomainDropConstraint({
      domain,
      constraint: domainConstraint,
    }),
  },
  {
    label: "domain.alter.validate_constraint",
    change: new AlterDomainValidateConstraint({
      domain,
      constraint: domainConstraint2,
    }),
  },
  { label: "domain.comment", change: new CreateCommentOnDomain({ domain }) },
  { label: "domain.drop_comment", change: new DropCommentOnDomain({ domain }) },
  {
    label: "domain.grant",
    change: new GrantDomainPrivileges({
      domain,
      grantee: "app_user",
      privileges: [{ privilege: "USAGE", grantable: false }],
    }),
  },
  {
    label: "domain.revoke",
    change: new RevokeDomainPrivileges({
      domain,
      grantee: "app_user",
      privileges: [{ privilege: "USAGE", grantable: false }],
    }),
  },
  {
    label: "domain.revoke_grant_option",
    change: new RevokeGrantOptionDomainPrivileges({
      domain,
      grantee: "app_user",
      privilegeNames: ["USAGE"],
    }),
  },

  // ── Enum ──
  { label: "type.enum.create", change: new CreateEnum({ enum: enumType }) },
  { label: "type.enum.drop", change: new DropEnum({ enum: enumType }) },
  {
    label: "type.enum.alter.change_owner",
    change: new AlterEnumChangeOwner({ enum: enumType, owner: "new_owner" }),
  },
  {
    label: "type.enum.alter.add_value",
    change: new AlterEnumAddValue({
      enum: enumType,
      newValue: "value4",
      position: { after: "value2" },
    }),
  },
  {
    label: "type.enum.comment",
    change: new CreateCommentOnEnum({ enum: enumType }),
  },
  {
    label: "type.enum.drop_comment",
    change: new DropCommentOnEnum({ enum: enumType }),
  },
  {
    label: "type.enum.grant",
    change: new GrantEnumPrivileges({
      enum: enumType,
      grantee: "app_user",
      privileges: [{ privilege: "USAGE", grantable: false }],
    }),
  },
  {
    label: "type.enum.revoke",
    change: new RevokeEnumPrivileges({
      enum: enumType,
      grantee: "app_user",
      privileges: [{ privilege: "USAGE", grantable: false }],
    }),
  },
  {
    label: "type.enum.revoke_grant_option",
    change: new RevokeGrantOptionEnumPrivileges({
      enum: enumType,
      grantee: "app_user",
      privilegeNames: ["USAGE"],
    }),
  },

  // ── Composite type ──
  {
    label: "type.composite.create",
    change: new CreateCompositeType({ compositeType }),
  },
  {
    label: "type.composite.drop",
    change: new DropCompositeType({ compositeType }),
  },
  {
    label: "type.composite.alter.change_owner",
    change: new AlterCompositeTypeChangeOwner({
      compositeType,
      owner: "new_owner",
    }),
  },
  {
    label: "type.composite.alter.add_attribute",
    change: new AlterCompositeTypeAddAttribute({
      compositeType,
      attribute: column({ name: "age", data_type_str: "integer" }),
    }),
  },
  {
    label: "type.composite.alter.drop_attribute",
    change: new AlterCompositeTypeDropAttribute({
      compositeType,
      attribute: column({ name: "name", data_type_str: "text" }),
    }),
  },
  {
    label: "type.composite.alter.alter_attr_type",
    change: new AlterCompositeTypeAlterAttributeType({
      compositeType,
      attribute: column({
        name: "name",
        data_type_str: "varchar(255)",
        collation: '"C"',
      }),
    }),
  },
  {
    label: "type.composite.comment",
    change: new CreateCommentOnCompositeType({ compositeType }),
  },
  {
    label: "type.composite.drop_comment",
    change: new DropCommentOnCompositeType({ compositeType }),
  },
  {
    label: "type.composite.attr_comment",
    change: new CreateCommentOnCompositeTypeAttribute({
      compositeType,
      attribute: column({
        name: "id",
        data_type_str: "integer",
        comment: "attr comment",
      }),
    }),
  },
  {
    label: "type.composite.drop_attr_comment",
    change: new DropCommentOnCompositeTypeAttribute({
      compositeType,
      attribute: column({ name: "id", data_type_str: "integer" }),
    }),
  },
  {
    label: "type.composite.grant",
    change: new GrantCompositeTypePrivileges({
      compositeType,
      grantee: "app_user",
      privileges: [{ privilege: "USAGE", grantable: false }],
    }),
  },
  {
    label: "type.composite.revoke",
    change: new RevokeCompositeTypePrivileges({
      compositeType,
      grantee: "app_user",
      privileges: [{ privilege: "USAGE", grantable: false }],
    }),
  },
  {
    label: "type.composite.revoke_grant_option",
    change: new RevokeGrantOptionCompositeTypePrivileges({
      compositeType,
      grantee: "app_user",
      privilegeNames: ["USAGE"],
    }),
  },

  // ── Range ──
  { label: "type.range.create", change: new CreateRange({ range: rangeType }) },
  { label: "type.range.drop", change: new DropRange({ range: rangeType }) },
  {
    label: "type.range.alter.change_owner",
    change: new AlterRangeChangeOwner({ range: rangeType, owner: "new_owner" }),
  },
  {
    label: "type.range.comment",
    change: new CreateCommentOnRange({ range: rangeType }),
  },
  {
    label: "type.range.drop_comment",
    change: new DropCommentOnRange({ range: rangeType }),
  },
  {
    label: "type.range.grant",
    change: new GrantRangePrivileges({
      range: rangeType,
      grantee: "app_user",
      privileges: [{ privilege: "USAGE", grantable: false }],
    }),
  },
  {
    label: "type.range.revoke",
    change: new RevokeRangePrivileges({
      range: rangeType,
      grantee: "app_user",
      privileges: [{ privilege: "USAGE", grantable: false }],
    }),
  },
  {
    label: "type.range.revoke_grant_option",
    change: new RevokeGrantOptionRangePrivileges({
      range: rangeType,
      grantee: "app_user",
      privilegeNames: ["USAGE"],
    }),
  },

  // ── Collation ──
  { label: "collation.create", change: new CreateCollation({ collation }) },
  { label: "collation.drop", change: new DropCollation({ collation }) },
  {
    label: "collation.alter.change_owner",
    change: new AlterCollationChangeOwner({ collation, owner: "new_owner" }),
  },
  {
    label: "collation.alter.refresh_version",
    change: new AlterCollationRefreshVersion({ collation }),
  },
  {
    label: "collation.comment",
    change: new CreateCommentOnCollation({ collation }),
  },
  {
    label: "collation.drop_comment",
    change: new DropCommentOnCollation({ collation }),
  },

  // ── Table ──
  { label: "table.create", change: new CreateTable({ table }) },
  { label: "table.drop", change: new DropTable({ table }) },
  {
    label: "table.alter.add_column",
    change: new AlterTableAddColumn({
      table,
      column: column({
        name: "email",
        data_type: "text",
        data_type_str: "text",
        not_null: true,
        default: "'user@example.com'",
        collation: '"en_US"',
      }),
    }),
  },
  {
    label: "table.alter.drop_column",
    change: new AlterTableDropColumn({
      table,
      column: column({
        name: "computed",
        data_type: "bigint",
        data_type_str: "bigint",
      }),
    }),
  },
  {
    label: "table.alter.column_type",
    change: new AlterTableAlterColumnType({
      table,
      column: column({
        name: "status",
        data_type: "varchar",
        data_type_str: "character varying(255)",
        collation: '"C"',
      }),
    }),
  },
  {
    label: "table.alter.column_set_default",
    change: new AlterTableAlterColumnSetDefault({
      table,
      column: column({
        name: "status",
        data_type: "text",
        data_type_str: "text",
        default: "'active'",
      }),
    }),
  },
  {
    label: "table.alter.column_drop_default",
    change: new AlterTableAlterColumnDropDefault({
      table,
      column: column({
        name: "status",
        data_type: "text",
        data_type_str: "text",
      }),
    }),
  },
  {
    label: "table.alter.column_set_not_null",
    change: new AlterTableAlterColumnSetNotNull({
      table,
      column: column({
        name: "status",
        data_type: "text",
        data_type_str: "text",
      }),
    }),
  },
  {
    label: "table.alter.column_drop_not_null",
    change: new AlterTableAlterColumnDropNotNull({
      table,
      column: column({
        name: "status",
        data_type: "text",
        data_type_str: "text",
      }),
    }),
  },
  {
    label: "table.alter.add_constraint",
    change: new AlterTableAddConstraint({
      table,
      constraint: uniqueConstraint,
    }),
  },
  {
    label: "table.alter.add_fk_constraint",
    change: new AlterTableAddConstraint({ table, constraint: fkConstraint }),
  },
  {
    label: "table.alter.drop_constraint",
    change: new AlterTableDropConstraint({
      table,
      constraint: uniqueConstraint,
    }),
  },
  {
    label: "table.alter.validate_constraint",
    change: new AlterTableValidateConstraint({
      table,
      constraint: checkConstraint,
    }),
  },
  {
    label: "table.alter.change_owner",
    change: new AlterTableChangeOwner({ table, owner: "new_owner" }),
  },
  {
    label: "table.alter.set_logged",
    change: new AlterTableSetLogged({ table }),
  },
  {
    label: "table.alter.set_unlogged",
    change: new AlterTableSetUnlogged({ table }),
  },
  {
    label: "table.alter.enable_rls",
    change: new AlterTableEnableRowLevelSecurity({ table }),
  },
  {
    label: "table.alter.disable_rls",
    change: new AlterTableDisableRowLevelSecurity({ table }),
  },
  {
    label: "table.alter.force_rls",
    change: new AlterTableForceRowLevelSecurity({ table }),
  },
  {
    label: "table.alter.no_force_rls",
    change: new AlterTableNoForceRowLevelSecurity({ table }),
  },
  {
    label: "table.alter.set_storage_params",
    change: new AlterTableSetStorageParams({
      table,
      options: ["fillfactor=80", "autovacuum_enabled=true"],
    }),
  },
  {
    label: "table.alter.reset_storage_params",
    change: new AlterTableResetStorageParams({
      table,
      params: ["fillfactor", "autovacuum_enabled"],
    }),
  },
  {
    label: "table.alter.replica_identity",
    change: new AlterTableSetReplicaIdentity({ table, mode: "f" }),
  },
  {
    label: "table.alter.attach_partition",
    change: new AlterTableAttachPartition({
      table: partitionedTable,
      partition: partitionChild,
    }),
  },
  {
    label: "table.alter.detach_partition",
    change: new AlterTableDetachPartition({
      table: partitionedTable,
      partition: partitionChild,
    }),
  },
  { label: "table.comment", change: new CreateCommentOnTable({ table }) },
  { label: "table.drop_comment", change: new DropCommentOnTable({ table }) },
  {
    label: "table.column_comment",
    change: new CreateCommentOnColumn({
      table,
      column: column({
        name: "id",
        data_type: "bigint",
        data_type_str: "bigint",
        comment: "id column",
      }),
    }),
  },
  {
    label: "table.drop_column_comment",
    change: new DropCommentOnColumn({
      table,
      column: column({
        name: "id",
        data_type: "bigint",
        data_type_str: "bigint",
      }),
    }),
  },
  {
    label: "table.constraint_comment",
    change: new CreateCommentOnConstraint({ table, constraint: pkConstraint }),
  },
  {
    label: "table.drop_constraint_comment",
    change: new DropCommentOnConstraint({ table, constraint: checkConstraint }),
  },
  {
    label: "table.grant",
    change: new GrantTablePrivileges({
      table,
      grantee: "app_reader",
      privileges: [
        { privilege: "SELECT", grantable: false },
        { privilege: "INSERT", grantable: false },
      ],
    }),
  },
  {
    label: "table.revoke",
    change: new RevokeTablePrivileges({
      table,
      grantee: "app_reader",
      privileges: [
        { privilege: "DELETE", grantable: false },
        { privilege: "UPDATE", grantable: false },
      ],
    }),
  },
  {
    label: "table.revoke_grant_option",
    change: new RevokeGrantOptionTablePrivileges({
      table,
      grantee: "app_reader",
      privilegeNames: ["SELECT", "INSERT"],
    }),
  },

  // ── Publication ──
  {
    label: "publication.create",
    change: new CreatePublication({ publication }),
  },
  { label: "publication.drop", change: new DropPublication({ publication }) },
  {
    label: "publication.alter.set_options",
    change: new AlterPublicationSetOptions({
      publication,
      setPublish: true,
      setPublishViaPartitionRoot: true,
    }),
  },
  {
    label: "publication.alter.set_all_tables",
    change: new AlterPublicationSetForAllTables({ publication }),
  },
  {
    label: "publication.alter.set_list",
    change: new AlterPublicationSetList({ publication }),
  },
  {
    label: "publication.alter.add_tables",
    change: new AlterPublicationAddTables({
      publication,
      tables: [
        {
          schema: "public",
          name: "new_table_with_very_long_name_for_formatting_and_wrapping_test",
          columns: null,
          row_filter: null,
        },
      ],
    }),
  },
  {
    label: "publication.alter.drop_tables",
    change: new AlterPublicationDropTables({
      publication,
      tables: [
        {
          schema: "public",
          name: "comments_a_little_smaller_name_than_the_previous_one",
          columns: null,
          row_filter: null,
        },
      ],
    }),
  },
  {
    label: "publication.alter.add_schemas",
    change: new AlterPublicationAddSchemas({
      publication,
      schemas: ["staging"],
    }),
  },
  {
    label: "publication.alter.drop_schemas",
    change: new AlterPublicationDropSchemas({
      publication,
      schemas: ["analytics"],
    }),
  },
  {
    label: "publication.alter.set_owner",
    change: new AlterPublicationSetOwner({ publication, owner: "new_owner" }),
  },
  {
    label: "publication.comment",
    change: new CreateCommentOnPublication({ publication }),
  },
  {
    label: "publication.drop_comment",
    change: new DropCommentOnPublication({ publication }),
  },

  // ── View ──
  { label: "view.create", change: new CreateView({ view }) },
  { label: "view.drop", change: new DropView({ view }) },
  {
    label: "view.alter.change_owner",
    change: new AlterViewChangeOwner({ view, owner: "new_owner" }),
  },
  {
    label: "view.alter.set_options",
    change: new AlterViewSetOptions({
      view,
      options: ["security_barrier=true", "check_option=cascaded"],
    }),
  },
  {
    label: "view.alter.reset_options",
    change: new AlterViewResetOptions({ view, params: ["security_barrier"] }),
  },
  { label: "view.comment", change: new CreateCommentOnView({ view }) },
  { label: "view.drop_comment", change: new DropCommentOnView({ view }) },
  {
    label: "view.grant",
    change: new GrantViewPrivileges({
      view,
      grantee: "app_reader",
      privileges: [{ privilege: "SELECT", grantable: true }],
    }),
  },
  {
    label: "view.revoke",
    change: new RevokeViewPrivileges({
      view,
      grantee: "app_reader",
      privileges: [{ privilege: "SELECT", grantable: false }],
    }),
  },
  {
    label: "view.revoke_grant_option",
    change: new RevokeGrantOptionViewPrivileges({
      view,
      grantee: "app_reader",
      privilegeNames: ["SELECT"],
    }),
  },

  // ── Rule ──
  { label: "rule.create", change: new CreateRule({ rule }) },
  { label: "rule.drop", change: new DropRule({ rule }) },
  { label: "rule.replace", change: new ReplaceRule({ rule }) },
  {
    label: "rule.alter.set_enabled",
    change: new SetRuleEnabledState({ rule, enabled: "D" }),
  },
  { label: "rule.comment", change: new CreateCommentOnRule({ rule }) },
  { label: "rule.drop_comment", change: new DropCommentOnRule({ rule }) },

  // ── Procedure ──
  { label: "procedure.create", change: new CreateProcedure({ procedure }) },
  { label: "procedure.drop", change: new DropProcedure({ procedure }) },

  // ── Function ──
  {
    label: "function.create",
    change: new CreateProcedure({ procedure: complexFunction }),
  },
  {
    label: "function.drop",
    change: new DropProcedure({ procedure: complexFunction }),
  },
  {
    label: "function.alter.change_owner",
    change: new AlterProcedureChangeOwner({
      procedure: complexFunction,
      owner: "new_admin",
    }),
  },
  {
    label: "function.alter.set_security",
    change: new AlterProcedureSetSecurity({
      procedure: complexFunction,
      securityDefiner: false,
    }),
  },
  {
    label: "function.alter.set_config",
    change: new AlterProcedureSetConfig({
      procedure: complexFunction,
      action: "set",
      key: "work_mem",
      value: "'256MB'",
    }),
  },
  {
    label: "function.alter.set_volatility",
    change: new AlterProcedureSetVolatility({
      procedure: complexFunction,
      volatility: "i",
    }),
  },
  {
    label: "function.alter.set_strictness",
    change: new AlterProcedureSetStrictness({
      procedure: complexFunction,
      isStrict: false,
    }),
  },
  {
    label: "function.alter.set_leakproof",
    change: new AlterProcedureSetLeakproof({
      procedure: complexFunction,
      leakproof: true,
    }),
  },
  {
    label: "function.alter.set_parallel",
    change: new AlterProcedureSetParallel({
      procedure: complexFunction,
      parallelSafety: "r",
    }),
  },
  {
    label: "function.comment",
    change: new CreateCommentOnProcedure({ procedure: complexFunction }),
  },
  {
    label: "function.drop_comment",
    change: new DropCommentOnProcedure({ procedure: complexFunction }),
  },
  {
    label: "function.grant",
    change: new GrantProcedurePrivileges({
      procedure: complexFunction,
      grantee: "app_user",
      privileges: [{ privilege: "EXECUTE", grantable: true }],
    }),
  },
  {
    label: "function.revoke",
    change: new RevokeProcedurePrivileges({
      procedure: complexFunction,
      grantee: "app_user",
      privileges: [{ privilege: "EXECUTE", grantable: false }],
    }),
  },
  {
    label: "function.revoke_grant_option",
    change: new RevokeGrantOptionProcedurePrivileges({
      procedure: complexFunction,
      grantee: "app_user",
      privilegeNames: ["EXECUTE"],
    }),
  },

  // ── Sequence ──
  { label: "sequence.create", change: new CreateSequence({ sequence }) },
  { label: "sequence.drop", change: new DropSequence({ sequence }) },
  {
    label: "sequence.alter.set_owned_by",
    change: new AlterSequenceSetOwnedBy({
      sequence,
      ownedBy: {
        schema: "public",
        table: "table_with_very_long_name_for_formatting_and_wrapping_test",
        column: "id",
      },
    }),
  },
  {
    label: "sequence.alter.set_options",
    change: new AlterSequenceSetOptions({
      sequence,
      options: [
        "INCREMENT BY 10",
        "MINVALUE 1",
        "MAXVALUE 1000000",
        "CACHE 5",
        "CYCLE",
      ],
    }),
  },
  {
    label: "sequence.comment",
    change: new CreateCommentOnSequence({ sequence }),
  },
  {
    label: "sequence.drop_comment",
    change: new DropCommentOnSequence({ sequence }),
  },
  {
    label: "sequence.grant",
    change: new GrantSequencePrivileges({
      sequence,
      grantee: "app_user",
      privileges: [
        { privilege: "USAGE", grantable: false },
        { privilege: "SELECT", grantable: false },
      ],
    }),
  },
  {
    label: "sequence.revoke",
    change: new RevokeSequencePrivileges({
      sequence,
      grantee: "app_user",
      privileges: [{ privilege: "USAGE", grantable: false }],
    }),
  },
  {
    label: "sequence.revoke_grant_option",
    change: new RevokeGrantOptionSequencePrivileges({
      sequence,
      grantee: "app_user",
      privilegeNames: ["USAGE"],
    }),
  },

  // ── RLS Policy ──
  {
    label: "policy.create",
    change: new CreateRlsPolicy({ policy: rlsPolicy }),
  },
  {
    label: "policy.create_restrictive",
    change: new CreateRlsPolicy({ policy: rlsPolicyRestrictive }),
  },
  { label: "policy.drop", change: new DropRlsPolicy({ policy: rlsPolicy }) },
  {
    label: "policy.alter.set_roles",
    change: new AlterRlsPolicySetRoles({
      policy: rlsPolicy,
      roles: ["authenticated", "anon"],
    }),
  },
  {
    label: "policy.alter.set_using",
    change: new AlterRlsPolicySetUsingExpression({
      policy: rlsPolicy,
      usingExpression: "auth.uid() = user_id AND status = 'active'",
    }),
  },
  {
    label: "policy.alter.set_with_check",
    change: new AlterRlsPolicySetWithCheckExpression({
      policy: rlsPolicy,
      withCheckExpression: "auth.uid() = user_id",
    }),
  },
  {
    label: "policy.comment",
    change: new CreateCommentOnRlsPolicy({ policy: rlsPolicy }),
  },
  {
    label: "policy.drop_comment",
    change: new DropCommentOnRlsPolicy({ policy: rlsPolicy }),
  },

  // ── Index ──
  {
    label: "index.create",
    change: new CreateIndex({ index, indexableObject: table }),
  },
  {
    label: "index.create_gin",
    change: new CreateIndex({ index: ginIndex, indexableObject: table }),
  },
  { label: "index.drop", change: new DropIndex({ index }) },
  {
    label: "index.alter.set_storage_params",
    change: new AlterIndexSetStorageParams({
      index,
      paramsToSet: ["fillfactor=80"],
      keysToReset: ["deduplicate_items"],
    }),
  },
  {
    label: "index.alter.set_statistics",
    change: new AlterIndexSetStatistics({
      index,
      columnTargets: [{ columnNumber: 1, statistics: 500 }],
    }),
  },
  { label: "index.comment", change: new CreateCommentOnIndex({ index }) },
  { label: "index.drop_comment", change: new DropCommentOnIndex({ index }) },

  // ── Trigger ──
  { label: "trigger.create", change: new CreateTrigger({ trigger }) },
  { label: "trigger.drop", change: new DropTrigger({ trigger }) },
  { label: "trigger.replace", change: new ReplaceTrigger({ trigger }) },
  { label: "trigger.comment", change: new CreateCommentOnTrigger({ trigger }) },
  {
    label: "trigger.drop_comment",
    change: new DropCommentOnTrigger({ trigger }),
  },

  // ── Materialized View ──
  {
    label: "matview.create",
    change: new CreateMaterializedView({ materializedView }),
  },
  {
    label: "matview.drop",
    change: new DropMaterializedView({ materializedView }),
  },
  {
    label: "matview.alter.change_owner",
    change: new AlterMaterializedViewChangeOwner({
      materializedView,
      owner: "new_owner",
    }),
  },
  {
    label: "matview.alter.set_storage",
    change: new AlterMaterializedViewSetStorageParams({
      materializedView,
      paramsToSet: ["fillfactor=80"],
      keysToReset: ["autovacuum_enabled"],
    }),
  },
  {
    label: "matview.comment",
    change: new CreateCommentOnMaterializedView({ materializedView }),
  },
  {
    label: "matview.drop_comment",
    change: new DropCommentOnMaterializedView({ materializedView }),
  },
  {
    label: "matview.column_comment",
    change: new CreateCommentOnMaterializedViewColumn({
      materializedView,
      column: column({
        name: "day",
        data_type: "timestamptz",
        data_type_str: "timestamptz",
        comment: "day bucket",
      }),
    }),
  },
  {
    label: "matview.drop_column_comment",
    change: new DropCommentOnMaterializedViewColumn({
      materializedView,
      column: column({
        name: "day",
        data_type: "timestamptz",
        data_type_str: "timestamptz",
      }),
    }),
  },
  {
    label: "matview.grant",
    change: new GrantMaterializedViewPrivileges({
      materializedView,
      grantee: "app_reader",
      privileges: [{ privilege: "SELECT", grantable: false }],
    }),
  },
  {
    label: "matview.revoke",
    change: new RevokeMaterializedViewPrivileges({
      materializedView,
      grantee: "app_reader",
      privileges: [{ privilege: "SELECT", grantable: false }],
    }),
  },
  {
    label: "matview.revoke_grant_option",
    change: new RevokeGrantOptionMaterializedViewPrivileges({
      materializedView,
      grantee: "app_reader",
      privilegeNames: ["SELECT"],
    }),
  },

  // ── Aggregate ──
  { label: "aggregate.create", change: new CreateAggregate({ aggregate }) },
  { label: "aggregate.drop", change: new DropAggregate({ aggregate }) },
  {
    label: "aggregate.alter.change_owner",
    change: new AlterAggregateChangeOwner({ aggregate, owner: "new_owner" }),
  },
  {
    label: "aggregate.comment",
    change: new CreateCommentOnAggregate({ aggregate }),
  },
  {
    label: "aggregate.drop_comment",
    change: new DropCommentOnAggregate({ aggregate }),
  },
  {
    label: "aggregate.grant",
    change: new GrantAggregatePrivileges({
      aggregate,
      grantee: "app_user",
      privileges: [{ privilege: "EXECUTE", grantable: false }],
    }),
  },
  {
    label: "aggregate.revoke",
    change: new RevokeAggregatePrivileges({
      aggregate,
      grantee: "app_user",
      privileges: [{ privilege: "EXECUTE", grantable: false }],
    }),
  },
  {
    label: "aggregate.revoke_grant_option",
    change: new RevokeGrantOptionAggregatePrivileges({
      aggregate,
      grantee: "app_user",
      privilegeNames: ["EXECUTE"],
    }),
  },

  // ── Event Trigger ──
  {
    label: "event_trigger.create",
    change: new CreateEventTrigger({ eventTrigger }),
  },
  {
    label: "event_trigger.drop",
    change: new DropEventTrigger({ eventTrigger }),
  },
  {
    label: "event_trigger.alter.change_owner",
    change: new AlterEventTriggerChangeOwner({
      eventTrigger,
      owner: "new_owner",
    }),
  },
  {
    label: "event_trigger.alter.set_enabled",
    change: new AlterEventTriggerSetEnabled({ eventTrigger, enabled: "D" }),
  },
  {
    label: "event_trigger.comment",
    change: new CreateCommentOnEventTrigger({ eventTrigger }),
  },
  {
    label: "event_trigger.drop_comment",
    change: new DropCommentOnEventTrigger({ eventTrigger }),
  },

  // ── Language ──
  { label: "language.create", change: new CreateLanguage({ language }) },
  { label: "language.drop", change: new DropLanguage({ language }) },
  {
    label: "language.alter.change_owner",
    change: new AlterLanguageChangeOwner({ language, owner: "new_owner" }),
  },
  {
    label: "language.comment",
    change: new CreateCommentOnLanguage({ language }),
  },
  {
    label: "language.drop_comment",
    change: new DropCommentOnLanguage({ language }),
  },
  {
    label: "language.grant",
    change: new GrantLanguagePrivileges({
      language,
      grantee: "app_user",
      privileges: [{ privilege: "USAGE", grantable: true }],
    }),
  },
  {
    label: "language.revoke",
    change: new RevokeLanguagePrivileges({
      language,
      grantee: "app_user",
      privileges: [{ privilege: "USAGE", grantable: false }],
    }),
  },
  {
    label: "language.revoke_grant_option",
    change: new RevokeGrantOptionLanguagePrivileges({
      language,
      grantee: "app_user",
      privilegeNames: ["USAGE"],
    }),
  },

  // ── Role ──
  { label: "role.create", change: new CreateRole({ role }) },
  { label: "role.drop", change: new DropRole({ role }) },
  {
    label: "role.alter.set_options",
    change: new AlterRoleSetOptions({
      role,
      options: ["NOSUPERUSER", "CREATEDB"],
    }),
  },
  {
    label: "role.alter.set_config",
    change: new AlterRoleSetConfig({
      role,
      action: "set",
      key: "statement_timeout",
      value: "'60000'",
    }),
  },
  { label: "role.comment", change: new CreateCommentOnRole({ role }) },
  { label: "role.drop_comment", change: new DropCommentOnRole({ role }) },
  {
    label: "role.grant_membership",
    change: new GrantRoleMembership({
      role,
      member: "dev_user",
      options: { admin: true, inherit: true, set: true },
    }),
  },
  {
    label: "role.revoke_membership",
    change: new RevokeRoleMembership({ role, member: "dev_user" }),
  },
  {
    label: "role.revoke_membership_options",
    change: new RevokeRoleMembershipOptions({
      role,
      member: "dev_user",
      admin: true,
    }),
  },
  {
    label: "role.grant_default_privileges",
    change: new GrantRoleDefaultPrivileges({
      role,
      inSchema: "public",
      objtype: "r",
      grantee: "app_reader",
      privileges: [{ privilege: "SELECT", grantable: false }],
      version: 1,
    }),
  },
  {
    label: "role.revoke_default_privileges",
    change: new RevokeRoleDefaultPrivileges({
      role,
      inSchema: "public",
      objtype: "r",
      grantee: "app_reader",
      privileges: [{ privilege: "SELECT", grantable: false }],
      version: 1,
    }),
  },

  // ── Subscription ──
  {
    label: "subscription.create",
    change: new CreateSubscription({ subscription }),
  },
  {
    label: "subscription.drop",
    change: new DropSubscription({ subscription }),
  },
  {
    label: "subscription.alter.set_connection",
    change: new AlterSubscriptionSetConnection({ subscription }),
  },
  {
    label: "subscription.alter.set_publication",
    change: new AlterSubscriptionSetPublication({ subscription }),
  },
  {
    label: "subscription.alter.enable",
    change: new AlterSubscriptionEnable({ subscription }),
  },
  {
    label: "subscription.alter.disable",
    change: new AlterSubscriptionDisable({ subscription }),
  },
  {
    label: "subscription.alter.set_options",
    change: new AlterSubscriptionSetOptions({
      subscription,
      options: ["binary", "streaming", "synchronous_commit"],
    }),
  },
  {
    label: "subscription.alter.set_owner",
    change: new AlterSubscriptionSetOwner({ subscription, owner: "new_owner" }),
  },
  {
    label: "subscription.comment",
    change: new CreateCommentOnSubscription({ subscription }),
  },
  {
    label: "subscription.drop_comment",
    change: new DropCommentOnSubscription({ subscription }),
  },

  // ── Foreign Data Wrapper ──
  {
    label: "fdw.create",
    change: new CreateForeignDataWrapper({ foreignDataWrapper }),
  },
  {
    label: "fdw.drop",
    change: new DropForeignDataWrapper({ foreignDataWrapper }),
  },
  {
    label: "fdw.alter.change_owner",
    change: new AlterForeignDataWrapperChangeOwner({
      foreignDataWrapper,
      owner: "new_owner",
    }),
  },
  {
    label: "fdw.alter.set_options",
    change: new AlterForeignDataWrapperSetOptions({
      foreignDataWrapper,
      options: [
        { action: "SET", option: "debug", value: "false" },
        { action: "ADD", option: "use_remote_estimate" },
      ],
    }),
  },
  {
    label: "fdw.comment",
    change: new CreateCommentOnForeignDataWrapper({ foreignDataWrapper }),
  },
  {
    label: "fdw.drop_comment",
    change: new DropCommentOnForeignDataWrapper({ foreignDataWrapper }),
  },
  {
    label: "fdw.grant",
    change: new GrantForeignDataWrapperPrivileges({
      foreignDataWrapper,
      grantee: "app_user",
      privileges: [{ privilege: "USAGE", grantable: false }],
    }),
  },
  {
    label: "fdw.revoke",
    change: new RevokeForeignDataWrapperPrivileges({
      foreignDataWrapper,
      grantee: "app_user",
      privileges: [{ privilege: "USAGE", grantable: false }],
    }),
  },
  {
    label: "fdw.revoke_grant_option",
    change: new RevokeGrantOptionForeignDataWrapperPrivileges({
      foreignDataWrapper,
      grantee: "app_user",
      privilegeNames: ["USAGE"],
    }),
  },

  // ── Foreign Table ──
  {
    label: "foreign_table.create",
    change: new CreateForeignTable({ foreignTable }),
  },
  {
    label: "foreign_table.drop",
    change: new DropForeignTable({ foreignTable }),
  },
  {
    label: "foreign_table.alter.change_owner",
    change: new AlterForeignTableChangeOwner({
      foreignTable,
      owner: "new_owner",
    }),
  },
  {
    label: "foreign_table.alter.add_column",
    change: new AlterForeignTableAddColumn({
      foreignTable,
      column: column({
        name: "name",
        data_type: "text",
        data_type_str: "text",
        not_null: true,
        default: "'unknown'",
      }),
    }),
  },
  {
    label: "foreign_table.alter.drop_column",
    change: new AlterForeignTableDropColumn({
      foreignTable,
      columnName: "email",
    }),
  },
  {
    label: "foreign_table.alter.column_type",
    change: new AlterForeignTableAlterColumnType({
      foreignTable,
      columnName: "id",
      dataType: "bigint",
    }),
  },
  {
    label: "foreign_table.alter.column_set_default",
    change: new AlterForeignTableAlterColumnSetDefault({
      foreignTable,
      columnName: "email",
      defaultValue: "'nobody@example.com'",
    }),
  },
  {
    label: "foreign_table.alter.column_drop_default",
    change: new AlterForeignTableAlterColumnDropDefault({
      foreignTable,
      columnName: "email",
    }),
  },
  {
    label: "foreign_table.alter.column_set_not_null",
    change: new AlterForeignTableAlterColumnSetNotNull({
      foreignTable,
      columnName: "email",
    }),
  },
  {
    label: "foreign_table.alter.column_drop_not_null",
    change: new AlterForeignTableAlterColumnDropNotNull({
      foreignTable,
      columnName: "email",
    }),
  },
  {
    label: "foreign_table.alter.set_options",
    change: new AlterForeignTableSetOptions({
      foreignTable,
      options: [{ action: "SET", option: "fetch_size", value: "1000" }],
    }),
  },
  {
    label: "foreign_table.comment",
    change: new CreateCommentOnForeignTable({ foreignTable }),
  },
  {
    label: "foreign_table.drop_comment",
    change: new DropCommentOnForeignTable({ foreignTable }),
  },
  {
    label: "foreign_table.grant",
    change: new GrantForeignTablePrivileges({
      foreignTable,
      grantee: "app_reader",
      privileges: [{ privilege: "SELECT", grantable: false }],
    }),
  },
  {
    label: "foreign_table.revoke",
    change: new RevokeForeignTablePrivileges({
      foreignTable,
      grantee: "app_reader",
      privileges: [{ privilege: "SELECT", grantable: false }],
    }),
  },
  {
    label: "foreign_table.revoke_grant_option",
    change: new RevokeGrantOptionForeignTablePrivileges({
      foreignTable,
      grantee: "app_reader",
      privilegeNames: ["SELECT"],
    }),
  },

  // ── Server ──
  { label: "server.create", change: new CreateServer({ server }) },
  { label: "server.drop", change: new DropServer({ server }) },
  {
    label: "server.alter.change_owner",
    change: new AlterServerChangeOwner({ server, owner: "new_owner" }),
  },
  {
    label: "server.alter.set_version",
    change: new AlterServerSetVersion({ server, version: "17.0" }),
  },
  {
    label: "server.alter.set_options",
    change: new AlterServerSetOptions({
      server,
      options: [
        { action: "SET", option: "host", value: "new.host" },
        { action: "DROP", option: "port" },
      ],
    }),
  },
  { label: "server.comment", change: new CreateCommentOnServer({ server }) },
  { label: "server.drop_comment", change: new DropCommentOnServer({ server }) },
  {
    label: "server.grant",
    change: new GrantServerPrivileges({
      server,
      grantee: "app_user",
      privileges: [{ privilege: "USAGE", grantable: false }],
    }),
  },
  {
    label: "server.revoke",
    change: new RevokeServerPrivileges({
      server,
      grantee: "app_user",
      privileges: [{ privilege: "USAGE", grantable: false }],
    }),
  },
  {
    label: "server.revoke_grant_option",
    change: new RevokeGrantOptionServerPrivileges({
      server,
      grantee: "app_user",
      privilegeNames: ["USAGE"],
    }),
  },

  // ── User Mapping ──
  {
    label: "user_mapping.create",
    change: new CreateUserMapping({ userMapping }),
  },
  { label: "user_mapping.drop", change: new DropUserMapping({ userMapping }) },
  {
    label: "user_mapping.alter.set_options",
    change: new AlterUserMappingSetOptions({
      userMapping,
      options: [{ action: "SET", option: "password", value: "new_secret" }],
    }),
  },
];

const renderChanges = (changes: ChangeCase[]): string[] =>
  changes.map(({ label, change }) => `-- ${label}\n${change.serialize()}`);

export function renderScript(options?: SqlFormatOptions): string {
  return formatSqlScript(renderChanges(changeCases), options);
}
