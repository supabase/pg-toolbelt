import type { SerializeOptions } from "../../../src/core/integrations/serialize/serialize.types.ts";
import type { ColumnProps } from "../../../src/core/objects/base.model.ts";
import { Aggregate } from "../../../src/core/objects/aggregate/aggregate.model.ts";
import { Collation } from "../../../src/core/objects/collation/collation.model.ts";
import { Domain, type DomainConstraintProps } from "../../../src/core/objects/domain/domain.model.ts";
import { ForeignDataWrapper } from "../../../src/core/objects/foreign-data-wrapper/foreign-data-wrapper/foreign-data-wrapper.model.ts";
import { ForeignTable } from "../../../src/core/objects/foreign-data-wrapper/foreign-table/foreign-table.model.ts";
import { Server } from "../../../src/core/objects/foreign-data-wrapper/server/server.model.ts";
import { UserMapping } from "../../../src/core/objects/foreign-data-wrapper/user-mapping/user-mapping.model.ts";
import { Extension } from "../../../src/core/objects/extension/extension.model.ts";
import { Index } from "../../../src/core/objects/index/index.model.ts";
import { Language } from "../../../src/core/objects/language/language.model.ts";
import { MaterializedView } from "../../../src/core/objects/materialized-view/materialized-view.model.ts";
import { Publication } from "../../../src/core/objects/publication/publication.model.ts";
import { Procedure } from "../../../src/core/objects/procedure/procedure.model.ts";
import { Range } from "../../../src/core/objects/type/range/range.model.ts";
import { Enum } from "../../../src/core/objects/type/enum/enum.model.ts";
import { CompositeType } from "../../../src/core/objects/type/composite-type/composite-type.model.ts";
import { RlsPolicy } from "../../../src/core/objects/rls-policy/rls-policy.model.ts";
import { Role } from "../../../src/core/objects/role/role.model.ts";
import { Rule } from "../../../src/core/objects/rule/rule.model.ts";
import { Schema } from "../../../src/core/objects/schema/schema.model.ts";
import { Sequence } from "../../../src/core/objects/sequence/sequence.model.ts";
import { Subscription } from "../../../src/core/objects/subscription/subscription.model.ts";
import { Table, type TableConstraintProps } from "../../../src/core/objects/table/table.model.ts";
import { Trigger } from "../../../src/core/objects/trigger/trigger.model.ts";
import { View } from "../../../src/core/objects/view/view.model.ts";
import { EventTrigger } from "../../../src/core/objects/event-trigger/event-trigger.model.ts";

export type FormatCase = {
  name: string;
  header: string;
  options?: SerializeOptions;
};

export type ChangeCase = {
  label: string;
  change: { serialize: (options?: SerializeOptions) => string };
};

export const formatCases: FormatCase[] = [
  {
    name: "format-off",
    header: "format: off",
    options: undefined,
  },
  {
    name: "format-pretty-upper",
    header: "format: { enabled: true }",
    options: { format: { enabled: true } },
  },
  {
    name: "format-pretty-lower-leading",
    header:
      "format: { enabled: true, keywordCase: 'lower', commaStyle: 'leading', alignColumns: true, indentWidth: 4 }",
    options: {
      format: {
        enabled: true,
        keywordCase: "lower",
        commaStyle: "leading",
        alignColumns: true,
        indentWidth: 4,
      },
    },
  },
  {
    name: "format-pretty-narrow",
    header: "format: { enabled: true, lineWidth: 40 }",
    options: {
      format: {
        enabled: true,
        lineWidth: 40,
      },
    },
  },
  {
    name: "format-pretty-preserve",
    header:
      "format: { enabled: true, keywordCase: 'preserve', alignColumns: false, indentWidth: 3 }",
    options: {
      format: {
        enabled: true,
        keywordCase: "preserve",
        alignColumns: false,
        indentWidth: 3,
      },
    },
  },
];

export const pgVersion = 170000;

export const column = (
  overrides: Partial<ColumnProps> = {},
): ColumnProps => ({
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

export const priv = (privilege: string, grantable = false) => ({
  privilege,
  grantable,
});

export const schema = new Schema({
  name: "app",
  owner: "owner1",
  comment: "app schema",
  privileges: [],
});

export const role = new Role({
  name: "role_main",
  is_superuser: true,
  can_inherit: false,
  can_create_roles: true,
  can_create_databases: true,
  can_login: true,
  can_replicate: true,
  connection_limit: 5,
  can_bypass_rls: true,
  config: null,
  comment: "role comment",
  members: [],
  default_privileges: [],
});

export const tableConstraint: TableConstraintProps = {
  name: "chk_positive",
  constraint_type: "c",
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
  check_expression: "id > 0",
  owner: "owner1",
  definition: "CHECK (id > 0)",
  comment: "constraint comment",
};

export const table = new Table({
  schema: "public",
  name: "t_fmt",
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
  options: ["fillfactor=70"],
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
      comment: "id column",
    }),
    column({
      name: "status",
      data_type: "text",
      data_type_str: "text",
      default: "'pending'",
      comment: "status column",
    }),
  ],
  constraints: [tableConstraint],
  privileges: [],
});

export const partitionedTable = new Table({
  schema: "public",
  name: "t_parent",
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
  partition_by: "RANGE (id)",
  owner: "owner1",
  comment: null,
  parent_schema: null,
  parent_name: null,
  columns: [column({ name: "id", data_type_str: "bigint" })],
  constraints: [],
  privileges: [],
});

export const partitionTable = new Table({
  schema: "public",
  name: "t_child_1",
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
  partition_bound: "FOR VALUES FROM (1) TO (100)",
  partition_by: null,
  owner: "owner1",
  comment: null,
  parent_schema: "public",
  parent_name: "t_parent",
  columns: [column({ name: "id", data_type_str: "bigint" })],
  constraints: [],
  privileges: [],
});

export const domainConstraint: DomainConstraintProps = {
  name: "domain_chk",
  validated: true,
  is_local: true,
  no_inherit: false,
  check_expression: "VALUE <> ''",
};

export const domain = new Domain({
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

export const sequence = new Sequence({
  schema: "public",
  name: "s_all",
  data_type: "integer",
  start_value: 10,
  minimum_value: 5n,
  maximum_value: 100n,
  increment: 2,
  cycle_option: true,
  cache_size: 3,
  persistence: "p",
  owned_by_schema: null,
  owned_by_table: null,
  owned_by_column: null,
  comment: "sequence comment",
  privileges: [],
  owner: "test",
});

export const enumType = new Enum({
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

export const compositeType = new CompositeType({
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

export const rangeType = new Range({
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

export const view = new View({
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

export const materializedView = new MaterializedView({
  schema: "public",
  name: "test_mv",
  definition: "SELECT * FROM test_table",
  row_security: false,
  force_row_security: false,
  has_indexes: false,
  has_rules: false,
  has_triggers: false,
  has_subclasses: false,
  is_populated: true,
  replica_identity: "d",
  is_partition: false,
  options: ["fillfactor=90", "autovacuum_enabled=false"],
  partition_bound: null,
  owner: "test",
  columns: [column({ name: "id", data_type_str: "integer", comment: "mv col" })],
  comment: "mat view comment",
  privileges: [],
});

export const index = new Index({
  schema: "public",
  table_name: "test_table",
  name: "test_index",
  storage_params: [],
  statistics_target: [0],
  index_type: "btree",
  tablespace: null,
  is_unique: false,
  is_primary: false,
  is_exclusion: false,
  is_owned_by_constraint: false,
  nulls_not_distinct: false,
  immediate: true,
  is_clustered: false,
  is_replica_identity: false,
  key_columns: [1],
  column_collations: [],
  operator_classes: [],
  column_options: [],
  index_expressions: null,
  partial_predicate: null,
  table_relkind: "r",
  is_partitioned_index: false,
  is_index_partition: false,
  parent_index_name: null,
  definition: "CREATE INDEX test_index ON public.test_table (id)",
  comment: "index comment",
  owner: "test",
});

export const procedure = new Procedure({
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
  definition: "CREATE PROCEDURE public.test_procedure() LANGUAGE plpgsql AS $$ begin null; end; $$",
  config: null,
});

export const trigger = new Trigger({
  schema: "public",
  table_name: "test_table",
  name: "test_trigger",
  function_schema: "public",
  function_name: "trigger_fn",
  trigger_type: (1 << 1) | (1 << 2) | (1 << 0),
  enabled: "O",
  is_internal: false,
  deferrable: false,
  initially_deferred: false,
  argument_count: 0,
  column_numbers: null,
  arguments: [],
  when_condition: null,
  old_table: null,
  new_table: null,
  is_partition_clone: false,
  parent_trigger_name: null,
  parent_table_schema: null,
  parent_table_name: null,
  is_on_partitioned_table: false,
  definition:
    "CREATE TRIGGER test_trigger AFTER INSERT ON public.test_table FOR EACH ROW EXECUTE FUNCTION public.trigger_fn()",
  comment: "trigger comment",
  owner: "test",
});

export const rule = new Rule({
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

export const aggregate = new Aggregate({
  schema: "public",
  name: "agg_sum",
  identity_arguments: "integer",
  kind: "a",
  aggkind: "n",
  num_direct_args: 0,
  return_type: "integer",
  return_type_schema: "pg_catalog",
  parallel_safety: "u",
  is_strict: false,
  transition_function: "pg_catalog.int4pl(integer,integer)",
  state_data_type: "integer",
  state_data_type_schema: "pg_catalog",
  state_data_space: 0,
  final_function: null,
  final_function_extra_args: false,
  final_function_modify: null,
  combine_function: null,
  serial_function: null,
  deserial_function: null,
  initial_condition: null,
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
  argument_types: ["integer"],
  all_argument_types: null,
  argument_modes: null,
  argument_defaults: null,
  owner: "owner1",
  comment: "aggregate comment",
  privileges: [],
});

export const policy = new RlsPolicy({
  schema: "public",
  name: "test_policy_all",
  table_name: "test_table",
  command: "w",
  permissive: false,
  roles: ["role1", "role2"],
  using_expression: "expr1",
  with_check_expression: "expr2",
  owner: "test",
  comment: "policy comment",
});

export const publication = new Publication({
  name: "pub_custom",
  owner: "owner1",
  comment: "publication comment",
  all_tables: false,
  publish_insert: true,
  publish_update: true,
  publish_delete: false,
  publish_truncate: false,
  publish_via_partition_root: true,
  tables: [
    {
      schema: "public",
      name: "articles",
      columns: null,
      row_filter: "id > 1",
    },
    {
      schema: "public",
      name: "authors",
      columns: ["name", "id"],
      row_filter: null,
    },
  ],
  schemas: ["analytics"],
});

export const subscription = new Subscription({
  name: "sub_base",
  raw_name: "sub_base",
  owner: "owner1",
  comment: "subscription comment",
  enabled: false,
  binary: true,
  streaming: "parallel",
  two_phase: true,
  disable_on_error: true,
  password_required: false,
  run_as_owner: true,
  failover: true,
  conninfo: "dbname=postgres application_name=sub_base",
  slot_name: "custom_slot",
  slot_is_none: false,
  replication_slot_created: false,
  synchronous_commit: "local",
  publications: ["pub_b", "pub_a"],
  origin: "none",
});

export const foreignDataWrapper = new ForeignDataWrapper({
  name: "test_fdw",
  owner: "test",
  handler: "public.handler_func()",
  validator: "public.validator_func()",
  options: ["host", "localhost", "port", "5432"],
  comment: "fdw comment",
  privileges: [],
});

export const server = new Server({
  name: "test_server",
  owner: "test",
  foreign_data_wrapper: "test_fdw",
  type: null,
  options: ["host", "localhost", "port", "5432"],
  version: "1.0",
  comment: "server comment",
  privileges: [],
});

export const foreignTable = new ForeignTable({
  schema: "public",
  name: "test_table",
  owner: "test",
  server: "test_server",
  options: ["schema_name", "remote_schema", "table_name", "remote_table"],
  comment: "foreign table comment",
  columns: [
    column({ name: "id", data_type: "integer", data_type_str: "integer" }),
    column({ name: "name", data_type: "text", data_type_str: "text" }),
  ],
  privileges: [],
});

export const userMapping = new UserMapping({
  user: "PUBLIC",
  server: "test_server",
  options: ["user", "remote_user", "password", "secret"],
});

export const extension = new Extension({
  name: "test_extension",
  schema: "public",
  relocatable: true,
  version: "1.0",
  owner: "test",
  comment: "extension comment",
  members: [],
});

export const language = new Language({
  name: "plpgsql",
  is_trusted: true,
  is_procedural: true,
  call_handler: "plpgsql_call_handler",
  inline_handler: "plpgsql_inline_handler",
  validator: "plpgsql_validator",
  owner: "test",
  comment: "language comment",
  privileges: [],
});

export const eventTrigger = new EventTrigger({
  name: "ddl_logger",
  event: "ddl_command_start",
  function_schema: "public",
  function_name: "log_ddl",
  enabled: "O",
  tags: ["CREATE TABLE", "ALTER TABLE"],
  owner: "postgres",
  comment: "event trigger comment",
});

export const collation = new Collation({
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

export const tableAlterColumn = column({
  name: "new_col",
  data_type: "text",
  data_type_str: "text",
  default: "'new'",
  not_null: true,
});

export const tableTypeColumn = column({
  name: "status",
  data_type: "varchar",
  data_type_str: "varchar(32)",
  collation: '"en_US"',
});

export const tableDefaultColumn = column({
  name: "created_at",
  data_type: "timestamptz",
  data_type_str: "timestamptz",
  default: "now()",
});

export const compositeAttribute = column({
  name: "new_attr",
  data_type: "text",
  data_type_str: "text",
  comment: "new attr comment",
});

export const renderChanges = (changes: ChangeCase[], options?: SerializeOptions) =>
  changes
    .map(({ label, change }) => `-- ${label}\n${change.serialize(options)}`)
    .join("\n\n");
