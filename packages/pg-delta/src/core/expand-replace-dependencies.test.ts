import { describe, expect, test } from "bun:test";
import { Catalog, createEmptyCatalog } from "./catalog.model.ts";
import type { Change } from "./change.types.ts";
import { expandReplaceDependencies } from "./expand-replace-dependencies.ts";
import { AlterAggregateChangeOwner } from "./objects/aggregate/changes/aggregate.alter.ts";
import { CreateCommentOnAggregate } from "./objects/aggregate/changes/aggregate.comment.ts";
import { CreateAggregate } from "./objects/aggregate/changes/aggregate.create.ts";
import { DropAggregate } from "./objects/aggregate/changes/aggregate.drop.ts";
import { GrantAggregatePrivileges } from "./objects/aggregate/changes/aggregate.privilege.ts";
import { CreateSecurityLabelOnAggregate } from "./objects/aggregate/changes/aggregate.security-label.ts";
import { Aggregate } from "./objects/aggregate/aggregate.model.ts";
import { DefaultPrivilegeState } from "./objects/base.default-privileges.ts";
import {
  AlterDomainAddConstraint,
  AlterDomainDropConstraint,
  AlterDomainDropDefault,
  AlterDomainSetDefault,
  AlterDomainValidateConstraint,
} from "./objects/domain/changes/domain.alter.ts";
import { CreateDomain } from "./objects/domain/changes/domain.create.ts";
import { DropDomain } from "./objects/domain/changes/domain.drop.ts";
import { Domain } from "./objects/domain/domain.model.ts";
import { CreateProcedure } from "./objects/procedure/changes/procedure.create.ts";
import { DropProcedure } from "./objects/procedure/changes/procedure.drop.ts";
import { Procedure } from "./objects/procedure/procedure.model.ts";
import { AlterIndexSetStatistics } from "./objects/index/changes/index.alter.ts";
import { CreateCommentOnIndex } from "./objects/index/changes/index.comment.ts";
import { CreateIndex } from "./objects/index/changes/index.create.ts";
import { DropIndex } from "./objects/index/changes/index.drop.ts";
import { Index, type IndexProps } from "./objects/index/index.model.ts";
import { AlterMaterializedViewClusterOn } from "./objects/materialized-view/changes/materialized-view.alter.ts";
import { CreateMaterializedView } from "./objects/materialized-view/changes/materialized-view.create.ts";
import { DropMaterializedView } from "./objects/materialized-view/changes/materialized-view.drop.ts";
import {
  MaterializedView,
  type MaterializedViewProps,
} from "./objects/materialized-view/materialized-view.model.ts";
import {
  AlterPublicationAddTables,
  AlterPublicationDropTables,
} from "./objects/publication/changes/publication.alter.ts";
import { CreatePublication } from "./objects/publication/changes/publication.create.ts";
import { DropPublication } from "./objects/publication/changes/publication.drop.ts";
import { Publication } from "./objects/publication/publication.model.ts";
import {
  AlterRlsPolicySetUsingExpression,
  AlterRlsPolicySetWithCheckExpression,
} from "./objects/rls-policy/changes/rls-policy.alter.ts";
import { CreateCommentOnRlsPolicy } from "./objects/rls-policy/changes/rls-policy.comment.ts";
import { CreateRlsPolicy } from "./objects/rls-policy/changes/rls-policy.create.ts";
import { DropRlsPolicy } from "./objects/rls-policy/changes/rls-policy.drop.ts";
import { RlsPolicy } from "./objects/rls-policy/rls-policy.model.ts";
import { CreateRule } from "./objects/rule/changes/rule.create.ts";
import { DropRule } from "./objects/rule/changes/rule.drop.ts";
import { Rule } from "./objects/rule/rule.model.ts";
import { AlterSequenceSetOwnedBy } from "./objects/sequence/changes/sequence.alter.ts";
import { CreateSequence } from "./objects/sequence/changes/sequence.create.ts";
import { DropSequence } from "./objects/sequence/changes/sequence.drop.ts";
import { diffSequences } from "./objects/sequence/sequence.diff.ts";
import { Sequence } from "./objects/sequence/sequence.model.ts";
import {
  AlterTableAddColumn,
  AlterTableAddConstraint,
  AlterTableAlterColumnDropDefault,
  AlterTableAlterColumnSetDefault,
  AlterTableChangeOwner,
  AlterTableClusterOn,
  AlterTableDropColumn,
  AlterTableDropConstraint,
  AlterTableEnableRowLevelSecurity,
  AlterTableForceRowLevelSecurity,
  AlterTableSetReplicaIdentity,
  AlterTableValidateConstraint,
} from "./objects/table/changes/table.alter.ts";
import {
  CreateCommentOnColumn,
  CreateCommentOnTable,
} from "./objects/table/changes/table.comment.ts";
import { CreateTable } from "./objects/table/changes/table.create.ts";
import { DropTable } from "./objects/table/changes/table.drop.ts";
import { GrantTablePrivileges } from "./objects/table/changes/table.privilege.ts";
import {
  CreateSecurityLabelOnColumn,
  CreateSecurityLabelOnTable,
} from "./objects/table/changes/table.security-label.ts";
import { Table, type TableProps } from "./objects/table/table.model.ts";
import { CreateTrigger } from "./objects/trigger/changes/trigger.create.ts";
import { DropTrigger } from "./objects/trigger/changes/trigger.drop.ts";
import { Trigger } from "./objects/trigger/trigger.model.ts";
import { CreateEnum } from "./objects/type/enum/changes/enum.create.ts";
import { DropEnum } from "./objects/type/enum/changes/enum.drop.ts";
import { Enum } from "./objects/type/enum/enum.model.ts";
import { CreateView } from "./objects/view/changes/view.create.ts";
import { DropView } from "./objects/view/changes/view.drop.ts";
import { View } from "./objects/view/view.model.ts";
import { sortChanges } from "./sort/sort-changes.ts";

function mockChange(overrides: {
  creates?: string[];
  drops?: string[];
}): Change {
  const { creates = [], drops = [] } = overrides;
  return {
    objectType: "table",
    operation: "create",
    scope: "object",
    creates,
    drops,
    invalidates: [],
    requires: [],
    table: { schema: "public", name: "t" },
    serialize: () => [],
    get requiresForDrop(): string[] {
      return [];
    },
  } as unknown as Change;
}

function mockInvalidatingChange(invalidates: string[]): Change {
  return {
    objectType: "table",
    operation: "alter",
    scope: "object",
    creates: [],
    drops: [],
    invalidates,
    requires: [],
    table: { schema: "public", name: "t" },
    serialize: () => "",
  } as unknown as Change;
}

function procedureWithArgs(
  argumentTypes: string[],
  name = "normalize_value",
): Procedure {
  return new Procedure({
    schema: "public",
    name,
    kind: "f",
    return_type: "integer",
    return_type_schema: "pg_catalog",
    language: "sql",
    security_definer: false,
    volatility: "i",
    parallel_safety: "u",
    execution_cost: 100,
    result_rows: 0,
    is_strict: false,
    leakproof: false,
    returns_set: false,
    argument_count: argumentTypes.length,
    argument_default_count: 0,
    argument_names: argumentTypes.map((_, index) => `arg${index + 1}`),
    argument_types: argumentTypes,
    all_argument_types: null,
    argument_modes: null,
    argument_defaults: null,
    source_code: "SELECT 1",
    binary_path: null,
    sql_body: null,
    config: null,
    definition: "CREATE FUNCTION public.normalize_value(...) RETURNS integer",
    owner: "postgres",
    comment: null,
    privileges: [],
  });
}

function tableWithDefault(
  columnDefault: string | null,
  columnOverrides: Partial<TableProps["columns"][number]> = {},
): Table {
  return new Table({
    schema: "public",
    name: "items",
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
    options: null,
    partition_bound: null,
    partition_by: null,
    owner: "postgres",
    comment: null,
    parent_schema: null,
    parent_name: null,
    columns: [
      {
        name: "value",
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
        default: columnDefault,
        comment: null,
        ...columnOverrides,
      },
    ],
    privileges: [],
  });
}

function tableNamedWithDefault(
  name: string,
  columnDefault: string | null,
  columnOverrides: Partial<TableProps["columns"][number]> = {},
): Table {
  return new Table({
    // oxlint-disable-next-line typescript/no-misused-spread
    ...tableWithDefault(columnDefault, columnOverrides),
    name,
  });
}

function partitionTableWithDefault(
  columnDefault: string | null,
  columnOverrides: Partial<TableProps["columns"][number]> = {},
): Table {
  const table = tableWithDefault(columnDefault, columnOverrides);
  return new Table({
    // oxlint-disable-next-line typescript/no-misused-spread
    ...table,
    name: "items_2026",
    is_partition: true,
    partition_bound: "FOR VALUES FROM (2026) TO (2027)",
    parent_schema: "public",
    parent_name: "items",
  });
}

function domainWithDefault(defaultValue: string | null): Domain {
  return new Domain({
    schema: "public",
    name: "item_value",
    base_type: "int4",
    base_type_schema: "pg_catalog",
    base_type_str: "integer",
    not_null: false,
    type_modifier: null,
    array_dimensions: null,
    collation: null,
    default_bin: defaultValue,
    default_value: defaultValue,
    owner: "postgres",
    comment: null,
    constraints: [],
    privileges: [],
  });
}

function domainWithConstraint(
  checkExpression: string,
  constraintOverrides: Partial<Domain["constraints"][number]> = {},
): Domain {
  return new Domain({
    schema: "public",
    name: "item_value",
    base_type: "int4",
    base_type_schema: "pg_catalog",
    base_type_str: "integer",
    not_null: false,
    type_modifier: null,
    array_dimensions: null,
    collation: null,
    default_bin: null,
    default_value: null,
    owner: "postgres",
    comment: null,
    constraints: [
      {
        name: "item_value_check",
        validated: true,
        is_local: true,
        no_inherit: false,
        check_expression: checkExpression,
        ...constraintOverrides,
      },
    ],
    privileges: [],
  });
}

function tableWithCheckConstraint(
  checkExpression: string,
  constraintOverrides: Partial<
    NonNullable<TableProps["constraints"]>[number]
  > = {},
): Table {
  const table = tableWithDefault(null);
  return new Table({
    // oxlint-disable-next-line typescript/no-misused-spread
    ...table,
    constraints: [
      {
        name: "items_value_check",
        constraint_type: "c",
        deferrable: false,
        initially_deferred: false,
        validated: true,
        is_local: true,
        no_inherit: false,
        is_temporal: false,
        is_partition_clone: false,
        parent_constraint_schema: null,
        parent_constraint_name: null,
        parent_table_schema: null,
        parent_table_name: null,
        key_columns: ["value"],
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
        check_expression: checkExpression,
        owner: "postgres",
        definition: `CHECK (${checkExpression})${
          constraintOverrides.validated === false ? " NOT VALID" : ""
        }`,
        comment: null,
        ...constraintOverrides,
      },
    ],
  });
}

function tableWithUniqueConstraint(
  tableOverrides: Partial<TableProps> = {},
  constraintOverrides: Partial<
    NonNullable<TableProps["constraints"]>[number]
  > = {},
): Table {
  const table = tableWithDefault("public.normalize_value(value)");
  return new Table({
    // oxlint-disable-next-line typescript/no-misused-spread
    ...table,
    constraints: [
      {
        name: "items_value_key",
        constraint_type: "u",
        deferrable: false,
        initially_deferred: false,
        validated: true,
        is_local: true,
        no_inherit: false,
        is_temporal: false,
        is_partition_clone: false,
        parent_constraint_schema: null,
        parent_constraint_name: null,
        parent_table_schema: null,
        parent_table_name: null,
        key_columns: ["value"],
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
        owner: "postgres",
        definition: "UNIQUE (value)",
        comment: null,
        ...constraintOverrides,
      },
    ],
    ...tableOverrides,
  });
}

function indexOnItemsValue(overrides: Partial<IndexProps> = {}): Index {
  return new Index({
    schema: "public",
    table_name: "items",
    name: "items_value_idx",
    storage_params: [],
    statistics_target: [],
    index_type: "btree",
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
    index_expressions: "value",
    partial_predicate: null,
    is_owned_by_constraint: false,
    table_relkind: "r",
    is_partitioned_index: false,
    is_index_partition: false,
    parent_index_name: null,
    definition: "CREATE INDEX items_value_idx ON public.items (value)",
    comment: null,
    owner: "postgres",
    ...overrides,
  });
}

function constraintBackedIndexOnItemsValue(
  overrides: Partial<IndexProps> = {},
): Index {
  return indexOnItemsValue({
    name: "items_value_key",
    is_unique: true,
    is_owned_by_constraint: true,
    key_columns: [1],
    index_expressions: null,
    definition: "CREATE UNIQUE INDEX items_value_key ON public.items (value)",
    ...overrides,
  });
}

function sequenceOwnedByItemsValue(): Sequence {
  return new Sequence({
    schema: "public",
    name: "items_value_seq",
    data_type: "bigint",
    start_value: 1,
    minimum_value: BigInt(1),
    maximum_value: BigInt("9223372036854775807"),
    increment: 1,
    cycle_option: false,
    cache_size: 1,
    persistence: "p",
    owned_by_schema: "public",
    owned_by_table: "items",
    owned_by_column: "value",
    comment: null,
    privileges: [],
    owner: "postgres",
    security_labels: [],
  });
}

function viewOnItemsValue(): View {
  return new View({
    schema: "public",
    name: "items_value_view",
    definition: " SELECT value FROM public.items;",
    row_security: false,
    force_row_security: false,
    has_indexes: false,
    has_rules: false,
    has_triggers: false,
    has_subclasses: false,
    is_populated: true,
    replica_identity: "d",
    is_partition: false,
    partition_bound: null,
    options: null,
    owner: "postgres",
    comment: null,
    columns: [
      {
        name: "value",
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
      },
    ],
    privileges: [],
  });
}

function materializedViewOnItemsValue(
  overrides: Partial<MaterializedViewProps> = {},
): MaterializedView {
  return new MaterializedView({
    schema: "public",
    name: "items_value_mv",
    definition: " SELECT value FROM public.items;",
    row_security: false,
    force_row_security: false,
    has_indexes: false,
    has_rules: false,
    has_triggers: false,
    has_subclasses: false,
    is_populated: true,
    replica_identity: "d",
    is_partition: false,
    partition_bound: null,
    options: null,
    owner: "postgres",
    comment: null,
    columns: [
      {
        name: "value",
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
      },
    ],
    privileges: [],
    ...overrides,
  });
}

function aggregateWithArgs(
  argumentTypes: string[],
  overrides: Partial<ConstructorParameters<typeof Aggregate>[0]> = {},
): Aggregate {
  return new Aggregate({
    schema: "public",
    name: "total_value",
    identity_arguments: argumentTypes.join(", "),
    kind: "a",
    aggkind: "n",
    num_direct_args: 0,
    return_type: "integer",
    return_type_schema: "pg_catalog",
    parallel_safety: "u",
    is_strict: false,
    transition_function: "public.sum_state",
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
    argument_count: argumentTypes.length,
    argument_default_count: 0,
    argument_names: null,
    argument_types: argumentTypes,
    all_argument_types: null,
    argument_modes: null,
    argument_defaults: null,
    owner: "postgres",
    comment: null,
    privileges: [],
    ...overrides,
  });
}

function triggerOnItemsValue(overrides: Partial<Trigger> = {}): Trigger {
  return new Trigger({
    schema: "public",
    name: "items_value_trigger",
    table_name: "items",
    table_relkind: "r",
    function_schema: "public",
    function_name: "touch_value",
    trigger_type: 16,
    enabled: "O",
    is_internal: false,
    deferrable: false,
    initially_deferred: false,
    argument_count: 0,
    column_numbers: [1],
    arguments: [],
    when_condition: null,
    old_table: null,
    new_table: null,
    is_partition_clone: false,
    parent_trigger_name: null,
    parent_table_schema: null,
    parent_table_name: null,
    is_on_partitioned_table: false,
    owner: "postgres",
    definition:
      "CREATE TRIGGER items_value_trigger AFTER UPDATE OF value ON public.items FOR EACH ROW EXECUTE FUNCTION public.touch_value()",
    comment: null,
    ...overrides,
  });
}

function ruleOnItemsValue(overrides: Partial<Rule> = {}): Rule {
  return new Rule({
    schema: "public",
    name: "items_value_rule",
    table_name: "items",
    relation_kind: "r",
    event: "UPDATE",
    enabled: "O",
    is_instead: false,
    owner: "postgres",
    definition:
      "CREATE RULE items_value_rule AS ON UPDATE TO public.items DO ALSO SELECT new.value",
    comment: null,
    columns: ["value"],
    ...overrides,
  });
}

function publicationOnItemsValue(rowFilter: string | null): Publication {
  return new Publication({
    name: "items_pub",
    owner: "postgres",
    comment: null,
    all_tables: false,
    publish_insert: true,
    publish_update: true,
    publish_delete: true,
    publish_truncate: true,
    publish_via_partition_root: false,
    tables: [
      {
        schema: "public",
        name: "items",
        columns: null,
        row_filter: rowFilter,
      },
    ],
    schemas: [],
  });
}

function publicationOnTables(
  tables: Publication["tables"],
  name = "items_pub",
): Publication {
  return new Publication({
    name,
    owner: "postgres",
    comment: null,
    all_tables: false,
    publish_insert: true,
    publish_update: true,
    publish_delete: true,
    publish_truncate: true,
    publish_via_partition_root: false,
    tables,
    schemas: [],
  });
}

describe("expandReplaceDependencies", () => {
  test("returns changes unchanged when there are no replace roots", async () => {
    const catalog = await createEmptyCatalog(160004, "u");
    const changes: Change[] = [
      mockChange({ creates: ["table:public.t"], drops: [] }),
    ];
    const result = expandReplaceDependencies({
      changes,
      mainCatalog: catalog,
      branchCatalog: catalog,
    });
    expect(result.changes).toHaveLength(1);
    expect(result.changes).toBe(changes);
    expect(result.replacedTableIds.size).toBe(0);
  });

  test("returns changes unchanged when replace roots have no dependents in catalog", async () => {
    const catalog = await createEmptyCatalog(160004, "u");
    const changes: Change[] = [
      mockChange({
        creates: ["type:public.e"],
        drops: ["type:public.e"],
      }),
    ];
    const result = expandReplaceDependencies({
      changes,
      mainCatalog: catalog,
      branchCatalog: catalog,
    });
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toBe(changes[0]);
    expect(result.replacedTableIds.size).toBe(0);
  });

  test("returns same array reference when replaceRoots.size is 0", async () => {
    const catalog = await createEmptyCatalog(160004, "u");
    const changes: Change[] = [
      mockChange({ creates: ["table:public.a"], drops: ["table:public.b"] }),
    ];
    const result = expandReplaceDependencies({
      changes,
      mainCatalog: catalog,
      branchCatalog: catalog,
    });
    expect(result.changes).toBe(changes);
    expect(result.replacedTableIds.size).toBe(0);
  });

  test("promotes surviving dependent view when its referenced table is dropped without a same-name create", async () => {
    // Reproduces issue #228 case 3: ALTER TABLE users RENAME TO members.
    // pg-delta sees `users` as drop-only and `members` as create-only — the
    // stableIds differ, so neither is in the createdIds∩droppedIds replace
    // root set. The dependent view `user_count` exists in both catalogs
    // (its definition was rewritten to FROM members in branch). Without
    // expansion, DROP TABLE users would fail because user_count still
    // references it. The expander must seed the drop-only table as a root
    // so the surviving dependent gets promoted to DROP+CREATE.
    const baseline = await createEmptyCatalog(170000, "postgres");
    const usersTable = new Table({
      schema: "public",
      name: "users",
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
      options: null,
      partition_bound: null,
      partition_by: null,
      owner: "postgres",
      comment: null,
      parent_schema: null,
      parent_name: null,
      columns: [
        {
          name: "id",
          position: 1,
          data_type: "integer",
          data_type_str: "integer",
          is_custom_type: false,
          custom_type_type: null,
          custom_type_category: null,
          custom_type_schema: null,
          custom_type_name: null,
          not_null: true,
          is_identity: false,
          is_identity_always: false,
          is_generated: false,
          collation: null,
          default: null,
          comment: null,
        },
      ],
      privileges: [],
    });
    const mainView = new View({
      schema: "public",
      name: "user_count",
      owner: "postgres",
      definition: " SELECT count(*) AS n FROM public.users;",
      row_security: false,
      force_row_security: false,
      has_indexes: false,
      has_rules: false,
      has_triggers: false,
      has_subclasses: false,
      is_populated: true,
      replica_identity: "d",
      is_partition: false,
      partition_bound: null,
      comment: null,
      columns: [
        {
          name: "n",
          position: 1,
          data_type: "bigint",
          data_type_str: "bigint",
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
        },
      ],
      options: null,
      privileges: [],
    });
    const branchView = new View({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainView,
      definition: " SELECT count(*) AS n FROM public.members;",
    });

    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      tables: { [usersTable.stableId]: usersTable },
      views: { [mainView.stableId]: mainView },
      depends: [
        {
          dependent_stable_id: mainView.stableId,
          referenced_stable_id: usersTable.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      views: { [branchView.stableId]: branchView },
    });

    // Simulated planner output: DropTable(users) + CreateView orReplace(user_count).
    // The surviving view appears only as a "create" (CREATE OR REPLACE VIEW),
    // never as a drop, so DROP TABLE users would fail without expansion.
    const changes: Change[] = [
      new DropTable({ table: usersTable }),
      new CreateView({ view: branchView, orReplace: true }),
    ];
    const result = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    // The view's surviving CREATE OR REPLACE remains, AND a DropView is
    // injected so the drop phase removes the view before the table.
    expect(result.changes.some((c) => c instanceof DropView)).toBe(true);
  });

  test("does not replace the owning table for an owned sequence recreation", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    // Use `persistence` (UNLOGGED → LOGGED) to trigger the
    // non-alterable replace path: it's the only field still in
    // NON_ALTERABLE_FIELDS. `data_type` was previously in that list
    // but is now alterable in place via ALTER SEQUENCE ... AS <type>.
    const mainSequence = new Sequence({
      schema: "public",
      name: "user_id_seq",
      data_type: "bigint",
      start_value: 1,
      minimum_value: 1n,
      maximum_value: 9223372036854775807n,
      increment: 1,
      cycle_option: false,
      cache_size: 1,
      persistence: "u",
      owned_by_schema: "public",
      owned_by_table: "users",
      owned_by_column: "id",
      comment: null,
      privileges: [],
      owner: "postgres",
    });
    const branchSequence = new Sequence({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainSequence,
      persistence: "p",
    });
    const usersTable = new Table({
      schema: "public",
      name: "users",
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
      options: null,
      partition_bound: null,
      partition_by: null,
      owner: "postgres",
      comment: null,
      parent_schema: null,
      parent_name: null,
      columns: [
        {
          name: "id",
          position: 1,
          data_type: "bigint",
          data_type_str: "bigint",
          is_custom_type: false,
          custom_type_type: null,
          custom_type_category: null,
          custom_type_schema: null,
          custom_type_name: null,
          not_null: true,
          is_identity: false,
          is_identity_always: false,
          is_generated: false,
          collation: null,
          default: "nextval('public.user_id_seq'::regclass)",
          comment: null,
        },
      ],
      privileges: [],
    });
    const changes = diffSequences(
      {
        version: 170000,
        currentUser: "postgres",
        defaultPrivilegeState: new DefaultPrivilegeState({}),
      },
      { [mainSequence.stableId]: mainSequence },
      { [branchSequence.stableId]: branchSequence },
      { [usersTable.stableId]: usersTable },
    );
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      sequences: { [mainSequence.stableId]: mainSequence },
      tables: { [usersTable.stableId]: usersTable },
      depends: [
        {
          dependent_stable_id: mainSequence.stableId,
          referenced_stable_id: "column:public.users.id",
          deptype: "a",
        },
        {
          dependent_stable_id: "column:public.users.id",
          referenced_stable_id: mainSequence.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      sequences: { [branchSequence.stableId]: branchSequence },
      tables: { [usersTable.stableId]: usersTable },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(changes[0]).toBeInstanceOf(DropSequence);
    expect(changes[1]).toBeInstanceOf(CreateSequence);
    expect(changes[3]).toBeInstanceOf(AlterTableAlterColumnSetDefault);
    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      false,
    );
    expect(
      expanded.changes.some((change) => change instanceof CreateTable),
    ).toBe(false);
    expect(expanded.replacedTableIds.size).toBe(0);
  });

  test("reports replaced tables for downstream post-diff normalization", async () => {
    // Reproduction guard for the enum-replacement expansion case: the expander
    // must report which dependent tables it promoted to DropTable+CreateTable,
    // but the pruning of same-table AlterTableDropColumn/DropConstraint belongs
    // to the later post-diff normalization pass, not this expansion step.
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainEnum = new Enum({
      schema: "public",
      name: "item_status",
      owner: "postgres",
      labels: [
        { sort_order: 1, label: "draft" },
        { sort_order: 2, label: "published" },
        { sort_order: 3, label: "archived" },
      ],
      comment: null,
      privileges: [],
    });
    const branchEnum = new Enum({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainEnum,
      labels: [
        { sort_order: 1, label: "draft" },
        { sort_order: 2, label: "published" },
      ],
    });
    const columnTemplate = {
      data_type: "integer" as const,
      data_type_str: "integer",
      is_custom_type: false as const,
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
    };
    const mainChildren = new Table({
      schema: "public",
      name: "children",
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
      options: null,
      partition_bound: null,
      partition_by: null,
      owner: "postgres",
      comment: null,
      parent_schema: null,
      parent_name: null,
      columns: [
        { ...columnTemplate, name: "id", position: 1, not_null: true },
        { ...columnTemplate, name: "parent_ref", position: 2 },
        {
          ...columnTemplate,
          name: "status",
          position: 3,
          data_type: "item_status",
          data_type_str: "public.item_status",
          is_custom_type: true,
          custom_type_type: "e",
          custom_type_category: "E",
          custom_type_schema: "public",
          custom_type_name: "item_status",
        },
      ],
      privileges: [],
    });
    const branchChildren = new Table({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainChildren,
      columns: [
        { ...columnTemplate, name: "id", position: 1, not_null: true },
        {
          ...columnTemplate,
          name: "status",
          position: 2,
          data_type: "item_status",
          data_type_str: "public.item_status",
          is_custom_type: true,
          custom_type_type: "e",
          custom_type_category: "E",
          custom_type_schema: "public",
          custom_type_name: "item_status",
        },
      ],
    });

    // Pre-existing planner output: the enum replacement from diffEnums plus
    // targeted ALTER TABLE statements from diffTables. The two cycle-forming
    // ALTERs (drop-column, drop-constraint) must be elided. The privilege
    // ALTER and the owner / RLS / replica-identity ALTERs must all survive.
    const droppedColumn = mainChildren.columns.find(
      (c) => c.name === "parent_ref",
    );
    if (!droppedColumn) throw new Error("test setup: parent_ref missing");
    const preExistingDropColumn = new AlterTableDropColumn({
      table: mainChildren,
      column: droppedColumn,
    });
    const preExistingDropConstraint = new AlterTableDropConstraint({
      table: mainChildren,
      constraint: {
        name: "children_parent_ref_fkey",
        constraint_type: "f",
        deferrable: false,
        initially_deferred: false,
        validated: true,
        is_local: true,
        no_inherit: false,
        is_temporal: false,
        is_partition_clone: false,
        parent_constraint_schema: null,
        parent_constraint_name: null,
        parent_table_schema: null,
        parent_table_name: null,
        key_columns: ["parent_ref"],
        foreign_key_columns: ["id"],
        foreign_key_table: "parents",
        foreign_key_schema: "public",
        foreign_key_table_is_partition: false,
        foreign_key_parent_schema: null,
        foreign_key_parent_table: null,
        foreign_key_effective_schema: "public",
        foreign_key_effective_table: "parents",
        on_update: "a",
        on_delete: "a",
        match_type: "s",
        check_expression: null,
        owner: "postgres",
        definition: "FOREIGN KEY (parent_ref) REFERENCES public.parents(id)",
        comment: null,
      },
    });
    const preExistingChangeOwner = new AlterTableChangeOwner({
      table: branchChildren,
      owner: "new_owner",
    });
    const preExistingEnableRls = new AlterTableEnableRowLevelSecurity({
      table: branchChildren,
    });
    const preExistingReplicaIdentity = new AlterTableSetReplicaIdentity({
      table: branchChildren,
      mode: "f",
    });
    const preExistingGrant = new GrantTablePrivileges({
      table: branchChildren,
      grantee: "reader",
      privileges: [{ privilege: "SELECT", grantable: false }],
    });
    const changes: Change[] = [
      new DropEnum({ enum: mainEnum }),
      new CreateEnum({ enum: branchEnum }),
      preExistingDropColumn,
      preExistingDropConstraint,
      preExistingChangeOwner,
      preExistingEnableRls,
      preExistingReplicaIdentity,
      preExistingGrant,
    ];

    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      enums: { [mainEnum.stableId]: mainEnum },
      tables: { [mainChildren.stableId]: mainChildren },
      // pg_depend: column children.status depends on type item_status.
      depends: [
        {
          dependent_stable_id: "column:public.children.status",
          referenced_stable_id: mainEnum.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      enums: { [branchEnum.stableId]: branchEnum },
      tables: { [branchChildren.stableId]: branchChildren },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    // The replace-table pair was added.
    expect(expanded.changes.some((c) => c instanceof DropTable)).toBe(true);
    expect(expanded.changes.some((c) => c instanceof CreateTable)).toBe(true);
    expect(expanded.replacedTableIds.has(mainChildren.stableId)).toBe(true);
    // Expansion itself keeps the pre-existing ALTERs; the post-diff cycle pass
    // decides which of them are superseded by the replacement.
    expect(expanded.changes).toContain(preExistingDropColumn);
    expect(expanded.changes).toContain(preExistingDropConstraint);
    expect(
      expanded.changes.some((c) => c instanceof AlterTableDropColumn),
    ).toBe(true);
    expect(
      expanded.changes.some((c) => c instanceof AlterTableDropConstraint),
    ).toBe(true);
    // The enum replace roots are still present.
    expect(expanded.changes.some((c) => c instanceof DropEnum)).toBe(true);
    expect(expanded.changes.some((c) => c instanceof CreateEnum)).toBe(true);
    // Non-cycle object-scope ALTERs are carried through untouched.
    expect(expanded.changes).toContain(preExistingChangeOwner);
    expect(expanded.changes).toContain(preExistingEnableRls);
    expect(expanded.changes).toContain(preExistingReplicaIdentity);
    // Privilege-scope ALTER on the recreated table survives.
    expect(expanded.changes).toContain(preExistingGrant);
    expect(expanded.replacedTableIds.has("table:public.parents")).toBe(false);
  });

  test("promotes dependent view when a procedure's parameter types change", async () => {
    // Procedure stableIds are signature-qualified, so a parameter-type change
    // produces different stableIds in `createdIds` and `droppedIds`. The
    // expander must still treat the (schema, name)-matched pair as a replace
    // root so a dependent view is promoted from `CREATE OR REPLACE VIEW` to
    // `DROP VIEW` + `CREATE VIEW` (otherwise `DROP FUNCTION` fails with
    // "cannot drop function because other objects depend on it").
    const baseline = await createEmptyCatalog(170000, "postgres");
    const procedureBase = {
      schema: "public",
      name: "format_id",
      kind: "f" as const,
      return_type: "text",
      return_type_schema: "pg_catalog",
      language: "sql",
      security_definer: false,
      volatility: "i" as const,
      parallel_safety: "u" as const,
      execution_cost: 100,
      result_rows: 0,
      is_strict: false,
      leakproof: false,
      returns_set: false,
      argument_count: 1,
      argument_default_count: 0,
      argument_names: ["id"],
      all_argument_types: null,
      argument_modes: null,
      argument_defaults: null,
      source_code: "SELECT 'id:' || id::text",
      binary_path: null,
      sql_body: null,
      config: null,
      owner: "postgres",
      comment: null,
      privileges: [],
    };
    const mainProcedure = new Procedure({
      ...procedureBase,
      argument_types: ["int4"],
      definition: "CREATE FUNCTION public.format_id(id integer) ...",
    });
    const branchProcedure = new Procedure({
      ...procedureBase,
      argument_types: ["int8"],
      definition: "CREATE FUNCTION public.format_id(id bigint) ...",
    });
    const viewBase = {
      schema: "public",
      name: "items_formatted",
      row_security: false,
      force_row_security: false,
      has_indexes: false,
      has_rules: false,
      has_triggers: false,
      has_subclasses: false,
      is_populated: true,
      replica_identity: "d" as const,
      is_partition: false,
      options: null,
      partition_bound: null,
      owner: "postgres",
      comment: null,
      columns: [],
      privileges: [],
    };
    const mainView = new View({
      ...viewBase,
      definition: "SELECT public.format_id(id) FROM public.items",
    });
    const branchView = new View({
      ...viewBase,
      definition: "SELECT public.format_id(id::bigint) FROM public.items",
    });

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
      // view.diff emits this because pg_get_viewdef text differs after the
      // underlying function signature changes.
      new CreateView({ view: branchView, orReplace: true }),
    ];

    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      views: { [mainView.stableId]: mainView },
      depends: [
        {
          dependent_stable_id: mainView.stableId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      views: { [branchView.stableId]: branchView },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(expanded.changes.some((c) => c instanceof DropView)).toBe(true);
  });

  test("promotes dependent RLS policy when a procedure's signature changes", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const procedureBase = {
      schema: "public",
      name: "check_role",
      kind: "f" as const,
      return_type: "boolean",
      return_type_schema: "pg_catalog",
      language: "plpgsql",
      security_definer: false,
      volatility: "v" as const,
      parallel_safety: "u" as const,
      execution_cost: 100,
      result_rows: 0,
      is_strict: false,
      leakproof: false,
      returns_set: false,
      argument_names: ["id", "role"],
      all_argument_types: null,
      argument_modes: null,
      source_code: "BEGIN RETURN true; END;",
      binary_path: null,
      sql_body: null,
      config: null,
      owner: "postgres",
      comment: null,
      privileges: [],
    };
    const mainProcedure = new Procedure({
      ...procedureBase,
      argument_count: 2,
      argument_default_count: 0,
      argument_types: ["uuid", "text"],
      argument_defaults: null,
      definition:
        "CREATE FUNCTION public.check_role(id uuid, role text) RETURNS boolean ...",
    });
    const branchProcedure = new Procedure({
      ...procedureBase,
      argument_count: 3,
      argument_default_count: 1,
      argument_names: ["id", "role", "extra"],
      argument_types: ["uuid", "text", "text"],
      argument_defaults: "'default'::text",
      definition:
        "CREATE FUNCTION public.check_role(id uuid, role text, extra text DEFAULT 'default'::text) RETURNS boolean ...",
    });
    const policyBase = {
      schema: "public",
      table_name: "profiles",
      name: "check_role_policy",
      command: "r" as const,
      permissive: true,
      roles: ["public"],
      using_expression: "public.check_role(id, role)",
      with_check_expression: null,
      owner: "postgres",
      comment: "policy comment",
      referenced_relations: [],
    };
    const mainPolicy = new RlsPolicy({
      ...policyBase,
      referenced_procedures: [
        {
          schema: "public",
          name: "check_role",
          argument_types: ["uuid", "text"],
        },
      ],
    });
    const branchPolicy = new RlsPolicy({
      ...policyBase,
      referenced_procedures: [
        {
          schema: "public",
          name: "check_role",
          argument_types: ["uuid", "text", "text"],
        },
      ],
    });

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      rlsPolicies: { [mainPolicy.stableId]: mainPolicy },
      depends: [
        {
          dependent_stable_id: mainPolicy.stableId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      rlsPolicies: { [branchPolicy.stableId]: branchPolicy },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(expanded.changes.some((c) => c instanceof DropRlsPolicy)).toBe(true);
    expect(expanded.changes.some((c) => c instanceof CreateRlsPolicy)).toBe(
      true,
    );
    expect(
      expanded.changes.some((c) => c instanceof CreateCommentOnRlsPolicy),
    ).toBe(true);
  });

  test("promotes dependent RLS policy when a referenced column is invalidated", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const columnTemplate = {
      position: 1,
      data_type: "text",
      data_type_str: "text",
      is_custom_type: false,
      custom_type_type: null,
      custom_type_category: null,
      custom_type_schema: null,
      custom_type_name: null,
      not_null: true,
      is_identity: false,
      is_identity_always: false,
      is_generated: false,
      collation: null,
      default: null,
      comment: null,
    };
    const tableBase = {
      schema: "public",
      name: "solution_categories_with_policy",
      persistence: "p" as const,
      row_security: true,
      force_row_security: false,
      has_indexes: false,
      has_rules: false,
      has_triggers: false,
      has_subclasses: false,
      is_populated: true,
      replica_identity: "d" as const,
      is_partition: false,
      options: null,
      partition_bound: null,
      partition_by: null,
      owner: "postgres",
      comment: null,
      parent_schema: null,
      parent_name: null,
      constraints: [],
      privileges: [],
    };
    const mainRoleColumn = {
      ...columnTemplate,
      name: "role",
    };
    const branchRoleColumn = {
      ...columnTemplate,
      name: "role",
      data_type: "user_role_enum",
      data_type_str: "public.user_role_enum",
      is_custom_type: true,
      custom_type_type: "e",
      custom_type_category: "E",
      custom_type_schema: "public",
      custom_type_name: "user_role_enum",
    };
    const mainTable = new Table({
      ...tableBase,
      columns: [mainRoleColumn],
    });
    const branchTable = new Table({
      ...tableBase,
      columns: [branchRoleColumn],
    });
    const policyBase = {
      schema: "public",
      table_name: "solution_categories_with_policy",
      name: "categories_admin_manage",
      command: "*" as const,
      permissive: true,
      roles: ["public"],
      owner: "postgres",
      comment: null,
      referenced_relations: [],
      referenced_procedures: [],
    };
    const mainPolicy = new RlsPolicy({
      ...policyBase,
      using_expression: "role = 'admin'",
      with_check_expression: "role = 'admin'",
    });
    const branchPolicy = new RlsPolicy({
      ...policyBase,
      using_expression: "role = 'admin'::public.user_role_enum",
      with_check_expression: "role = 'admin'::public.user_role_enum",
    });
    const alterUsing = new AlterRlsPolicySetUsingExpression({
      policy: mainPolicy,
      usingExpression: branchPolicy.using_expression,
    });
    const alterWithCheck = new AlterRlsPolicySetWithCheckExpression({
      policy: mainPolicy,
      withCheckExpression: branchPolicy.with_check_expression,
    });
    const changes: Change[] = [
      mockInvalidatingChange([
        "column:public.solution_categories_with_policy.role",
      ]),
      alterUsing,
      alterWithCheck,
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      tables: { [mainTable.stableId]: mainTable },
      rlsPolicies: { [mainPolicy.stableId]: mainPolicy },
      depends: [
        {
          dependent_stable_id: mainPolicy.stableId,
          referenced_stable_id:
            "column:public.solution_categories_with_policy.role",
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      tables: { [branchTable.stableId]: branchTable },
      rlsPolicies: { [branchPolicy.stableId]: branchPolicy },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(expanded.changes.some((c) => c instanceof DropRlsPolicy)).toBe(true);
    expect(expanded.changes.some((c) => c instanceof CreateRlsPolicy)).toBe(
      true,
    );
    expect(expanded.changes).not.toContain(alterUsing);
    expect(expanded.changes).not.toContain(alterWithCheck);
  });

  test("does not replace a table when a procedure signature replacement is covered by a column default alter", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = procedureWithArgs(["bigint"]);
    const mainTable = tableWithDefault("public.normalize_value(1)");
    const branchTable = tableWithDefault("public.normalize_value((1)::bigint)");
    const setDefault = new AlterTableAlterColumnSetDefault({
      table: branchTable,
      column: branchTable.columns[0],
    });

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
      setDefault,
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      tables: { [mainTable.stableId]: mainTable },
      depends: [
        {
          dependent_stable_id: "column:public.items.value",
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      tables: { [branchTable.stableId]: branchTable },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(expanded.changes).toContain(setDefault);
    expect(
      expanded.changes.some(
        (change) => change instanceof AlterTableAlterColumnDropDefault,
      ),
    ).toBe(true);
    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      false,
    );
    expect(
      expanded.changes.some((change) => change instanceof CreateTable),
    ).toBe(false);
    expect(expanded.replacedTableIds.has(mainTable.stableId)).toBe(false);
  });

  test("synthesizes a column default replacement for an unchanged expression that depends on a replaced procedure", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const mainTable = tableWithDefault("public.normalize_value(1)");
    const branchTable = tableWithDefault("public.normalize_value(1)");

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      tables: { [mainTable.stableId]: mainTable },
      depends: [
        {
          dependent_stable_id: "column:public.items.value",
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      tables: { [branchTable.stableId]: branchTable },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(
      expanded.changes.some(
        (change) => change instanceof AlterTableAlterColumnDropDefault,
      ),
    ).toBe(true);
    expect(
      expanded.changes.some(
        (change) => change instanceof AlterTableAlterColumnSetDefault,
      ),
    ).toBe(true);
    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      false,
    );
    expect(
      expanded.changes.some((change) => change instanceof CreateTable),
    ).toBe(false);
  });

  test("does not replace a table when a replaced procedure only drops a dependent column default", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const mainTable = tableWithDefault("public.normalize_value(1)");
    const branchTable = new Table({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainTable,
      columns: [],
    });
    const dropColumn = new AlterTableDropColumn({
      table: mainTable,
      column: mainTable.columns[0] as TableProps["columns"][number],
    });

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
      dropColumn,
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      tables: { [mainTable.stableId]: mainTable },
      depends: [
        {
          dependent_stable_id: "column:public.items.value",
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      tables: { [branchTable.stableId]: branchTable },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(expanded.changes).toContain(dropColumn);
    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterTableDropColumn,
      ),
    ).toHaveLength(1);
    expect(
      expanded.changes.some(
        (change) => change instanceof AlterTableAlterColumnSetDefault,
      ),
    ).toBe(false);
    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      false,
    );
    expect(
      expanded.changes.some((change) => change instanceof CreateTable),
    ).toBe(false);
    expect(expanded.replacedTableIds.has(mainTable.stableId)).toBe(false);
  });

  test("does not count unrelated constraint column requirements as column default restore coverage", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const mainTable = tableWithDefault("public.normalize_value(1)");
    const branchTable = tableWithDefault("public.normalize_value(1)");
    const referencedTable = tableNamedWithDefault("parents", null, {
      name: "id",
      not_null: true,
    });
    const addForeignKey = new AlterTableAddConstraint({
      table: branchTable,
      constraint: {
        name: "items_value_fkey",
        constraint_type: "f",
        deferrable: false,
        initially_deferred: false,
        validated: true,
        is_local: true,
        no_inherit: false,
        is_temporal: false,
        is_partition_clone: false,
        parent_constraint_schema: null,
        parent_constraint_name: null,
        parent_table_schema: null,
        parent_table_name: null,
        key_columns: ["value"],
        foreign_key_columns: ["id"],
        foreign_key_table: "parents",
        foreign_key_schema: "public",
        foreign_key_table_is_partition: false,
        foreign_key_parent_schema: null,
        foreign_key_parent_table: null,
        foreign_key_effective_schema: "public",
        foreign_key_effective_table: "parents",
        on_update: "a",
        on_delete: "a",
        match_type: "s",
        check_expression: null,
        owner: "postgres",
        definition: "FOREIGN KEY (value) REFERENCES public.parents(id)",
        comment: null,
      },
    });

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
      addForeignKey,
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      tables: {
        [mainTable.stableId]: mainTable,
        [referencedTable.stableId]: referencedTable,
      },
      depends: [
        {
          dependent_stable_id: "column:public.items.value",
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      tables: {
        [branchTable.stableId]: branchTable,
        [referencedTable.stableId]: referencedTable,
      },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(expanded.changes).toContain(addForeignKey);
    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterTableAlterColumnDropDefault,
      ),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterTableAlterColumnSetDefault,
      ),
    ).toHaveLength(1);
    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      false,
    );
    expect(
      expanded.changes.some((change) => change instanceof CreateTable),
    ).toBe(false);
  });

  test("synthesizes a generated column fallback before PostgreSQL 17 for an unchanged expression that depends on a same-signature procedure replacement", async () => {
    const baseline = await createEmptyCatalog(150000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const mainTable = tableWithDefault("public.normalize_value(value)", {
      is_generated: true,
    });
    const branchTable = tableWithDefault("public.normalize_value(value)", {
      is_generated: true,
    });

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      tables: { [mainTable.stableId]: mainTable },
      depends: [
        {
          dependent_stable_id: "column:public.items.value",
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      tables: { [branchTable.stableId]: branchTable },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
      diffContext: {
        version: 150000,
        currentUser: "postgres",
        defaultPrivilegeState: new DefaultPrivilegeState({}),
      },
    });

    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterTableDropColumn,
      ),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterTableAddColumn,
      ),
    ).toHaveLength(1);
    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      false,
    );
    expect(
      expanded.changes.some((change) => change instanceof CreateTable),
    ).toBe(false);
  });

  test("skips child generated column fallback when parent recreation covers inherited partition expressions", async () => {
    const baseline = await createEmptyCatalog(150000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const mainParentTable = tableWithDefault("public.normalize_value(value)", {
      is_generated: true,
    });
    const branchParentTable = tableWithDefault(
      "public.normalize_value(value)",
      {
        is_generated: true,
      },
    );
    const mainPartition = partitionTableWithDefault(
      "public.normalize_value(value)",
      {
        is_generated: true,
      },
    );
    const branchPartition = partitionTableWithDefault(
      "public.normalize_value(value)",
      {
        is_generated: true,
      },
    );
    const columnId = "column:public.items_2026.value";

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
      new AlterTableDropColumn({
        table: mainParentTable,
        column: mainParentTable.columns[0],
      }),
      new AlterTableAddColumn({
        table: branchParentTable,
        column: branchParentTable.columns[0],
      }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      tables: {
        [mainParentTable.stableId]: mainParentTable,
        [mainPartition.stableId]: mainPartition,
      },
      depends: [
        {
          dependent_stable_id: columnId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      tables: {
        [branchParentTable.stableId]: branchParentTable,
        [branchPartition.stableId]: branchPartition,
      },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
      diffContext: {
        version: 150000,
        currentUser: "postgres",
        defaultPrivilegeState: new DefaultPrivilegeState({}),
      },
    });

    expect(
      expanded.changes.filter(
        (change) =>
          change instanceof AlterTableDropColumn &&
          change.table.name === "items_2026",
      ),
    ).toHaveLength(0);
    expect(
      expanded.changes.filter(
        (change) =>
          change instanceof AlterTableAddColumn &&
          change.table.name === "items_2026",
      ),
    ).toHaveLength(0);
    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      false,
    );
    expect(
      expanded.changes.some((change) => change instanceof CreateTable),
    ).toBe(false);
  });

  test("restores child-specific generated partition expression despite parent dependency coverage", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const mainParentTable = tableWithDefault("public.normalize_value(value)", {
      is_generated: true,
    });
    const branchParentTable = tableWithDefault(
      "public.normalize_value(value)",
      {
        is_generated: true,
      },
    );
    const mainPartition = partitionTableWithDefault(
      "public.normalize_value(value + 1)",
      {
        is_generated: true,
      },
    );
    const branchPartition = partitionTableWithDefault(
      "public.normalize_value(value + 1)",
      {
        is_generated: true,
      },
    );

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
      new AlterTableDropColumn({
        table: mainParentTable,
        column: mainParentTable.columns[0],
      }),
      new AlterTableAddColumn({
        table: branchParentTable,
        column: branchParentTable.columns[0],
      }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      tables: {
        [mainParentTable.stableId]: mainParentTable,
        [mainPartition.stableId]: mainPartition,
      },
      depends: [
        {
          dependent_stable_id: "column:public.items.value",
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
        {
          dependent_stable_id: "column:public.items_2026.value",
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      tables: {
        [branchParentTable.stableId]: branchParentTable,
        [branchPartition.stableId]: branchPartition,
      },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
      diffContext: {
        version: 170000,
        currentUser: "postgres",
        defaultPrivilegeState: new DefaultPrivilegeState({}),
      },
    });

    expect(
      expanded.changes.filter(
        (change) =>
          change instanceof AlterTableDropColumn &&
          change.table.name === "items_2026",
      ),
    ).toHaveLength(0);
    expect(
      expanded.changes.filter(
        (change) =>
          change instanceof AlterTableAddColumn &&
          change.table.name === "items_2026",
      ),
    ).toHaveLength(0);
    expect(
      expanded.changes.filter(
        (change) =>
          change instanceof AlterTableAlterColumnSetDefault &&
          change.table.name === "items_2026",
      ),
    ).toHaveLength(1);
    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      false,
    );
    expect(
      expanded.changes.some((change) => change instanceof CreateTable),
    ).toBe(false);
  });

  test("skips child column DDL when partition-propagated drops remove inherited columns", async () => {
    const baseline = await createEmptyCatalog(150000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const mainTable = partitionTableWithDefault(
      "public.normalize_value(value)",
      {
        is_generated: true,
      },
    );
    const branchTable = new Table({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...partitionTableWithDefault(null),
      columns: [],
    });
    const columnId = "column:public.items_2026.value";

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      tables: { [mainTable.stableId]: mainTable },
      depends: [
        {
          dependent_stable_id: columnId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      tables: { [branchTable.stableId]: branchTable },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
      diffContext: {
        version: 150000,
        currentUser: "postgres",
        defaultPrivilegeState: new DefaultPrivilegeState({}),
      },
    });

    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterTableDropColumn,
      ),
    ).toHaveLength(0);
    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      false,
    );
    expect(
      expanded.changes.some((change) => change instanceof CreateTable),
    ).toBe(false);
  });

  test("releases a local partition column default that depends on a replaced procedure", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const mainTable = partitionTableWithDefault("public.normalize_value(1)");
    const branchTable = partitionTableWithDefault("public.normalize_value(1)");
    const columnId = "column:public.items_2026.value";

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      tables: { [mainTable.stableId]: mainTable },
      depends: [
        {
          dependent_stable_id: columnId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      tables: { [branchTable.stableId]: branchTable },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterTableAlterColumnDropDefault,
      ),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterTableAlterColumnSetDefault,
      ),
    ).toHaveLength(1);
    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      false,
    );
  });

  test("does not count child partition default changes as parent default restore coverage", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const mainParentTable = tableWithDefault("public.normalize_value(1)");
    const branchParentTable = tableWithDefault("public.normalize_value(1)");
    const mainPartition = partitionTableWithDefault(
      "public.normalize_value(2)",
    );
    const branchPartition = partitionTableWithDefault(
      "public.normalize_value(3)",
    );
    const childSetDefault = new AlterTableAlterColumnSetDefault({
      table: branchPartition,
      column: branchPartition.columns[0],
    });

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
      childSetDefault,
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      tables: {
        [mainParentTable.stableId]: mainParentTable,
        [mainPartition.stableId]: mainPartition,
      },
      depends: [
        {
          dependent_stable_id: "column:public.items.value",
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
        {
          dependent_stable_id: "column:public.items_2026.value",
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      tables: {
        [branchParentTable.stableId]: branchParentTable,
        [branchPartition.stableId]: branchPartition,
      },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(expanded.changes).toContain(childSetDefault);
    expect(
      expanded.changes.filter(
        (change) =>
          change instanceof AlterTableAlterColumnDropDefault &&
          change.table.name === "items",
      ),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter(
        (change) =>
          change instanceof AlterTableAlterColumnSetDefault &&
          change.table.name === "items",
      ),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter(
        (change) =>
          change instanceof AlterTableAlterColumnSetDefault &&
          change.table.name === "items_2026",
      ),
    ).toHaveLength(1);
    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      false,
    );
  });

  test("does not count generated SET EXPRESSION as release coverage for same-signature procedure replacement", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const mainTable = tableWithDefault("public.normalize_value(value)", {
      is_generated: true,
    });
    const branchTable = tableWithDefault("public.normalize_value(value + 1)", {
      is_generated: true,
    });
    const setExpression = new AlterTableAlterColumnSetDefault({
      table: branchTable,
      column: branchTable.columns[0],
    });

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
      setExpression,
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      tables: { [mainTable.stableId]: mainTable },
      depends: [
        {
          dependent_stable_id: "column:public.items.value",
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      tables: { [branchTable.stableId]: branchTable },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
      diffContext: {
        version: 170000,
        currentUser: "postgres",
        defaultPrivilegeState: new DefaultPrivilegeState({}),
      },
    });

    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterTableDropColumn,
      ),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterTableAddColumn,
      ),
    ).toHaveLength(1);
    expect(expanded.changes).not.toContain(setExpression);
    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      false,
    );
    expect(
      expanded.changes.some((change) => change instanceof CreateTable),
    ).toBe(false);
  });

  test("traverses retained dependents when generated column recreation is already covered", async () => {
    const baseline = await createEmptyCatalog(150000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const mainTable = tableWithDefault("public.normalize_value(value)", {
      is_generated: true,
    });
    const branchTable = tableWithDefault("public.normalize_value(value)", {
      is_generated: true,
    });
    const mainIndex = indexOnItemsValue();
    const branchIndex = indexOnItemsValue();
    const columnId = "column:public.items.value";
    const preExistingDropColumn = new AlterTableDropColumn({
      table: mainTable,
      column: mainTable.columns[0],
    });
    const preExistingAddColumn = new AlterTableAddColumn({
      table: branchTable,
      column: branchTable.columns[0],
    });

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
      preExistingDropColumn,
      preExistingAddColumn,
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      tables: { [mainTable.stableId]: mainTable },
      indexes: { [mainIndex.stableId]: mainIndex },
      depends: [
        {
          dependent_stable_id: columnId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
        {
          dependent_stable_id: mainIndex.stableId,
          referenced_stable_id: columnId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      tables: { [branchTable.stableId]: branchTable },
      indexes: { [branchIndex.stableId]: branchIndex },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
      diffContext: {
        version: 150000,
        currentUser: "postgres",
        defaultPrivilegeState: new DefaultPrivilegeState({}),
      },
    });

    expect(expanded.changes).toContain(preExistingDropColumn);
    expect(expanded.changes).toContain(preExistingAddColumn);
    expect(
      expanded.changes.filter((change) => change instanceof DropIndex),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter((change) => change instanceof CreateIndex),
    ).toHaveLength(1);
    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      false,
    );
  });

  test("traverses retained dependents when a regular column is recreated as generated", async () => {
    const baseline = await createEmptyCatalog(150000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const mainTable = tableWithDefault("public.normalize_value(value)");
    const branchTable = tableWithDefault("public.normalize_value(value)", {
      is_generated: true,
    });
    const mainIndex = indexOnItemsValue();
    const branchIndex = indexOnItemsValue();
    const columnId = "column:public.items.value";
    const preExistingDropColumn = new AlterTableDropColumn({
      table: mainTable,
      column: mainTable.columns[0],
    });
    const preExistingAddColumn = new AlterTableAddColumn({
      table: branchTable,
      column: branchTable.columns[0],
    });

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
      preExistingDropColumn,
      preExistingAddColumn,
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      tables: { [mainTable.stableId]: mainTable },
      indexes: { [mainIndex.stableId]: mainIndex },
      depends: [
        {
          dependent_stable_id: columnId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
        {
          dependent_stable_id: mainIndex.stableId,
          referenced_stable_id: columnId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      tables: { [branchTable.stableId]: branchTable },
      indexes: { [branchIndex.stableId]: branchIndex },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
      diffContext: {
        version: 150000,
        currentUser: "postgres",
        defaultPrivilegeState: new DefaultPrivilegeState({}),
      },
    });

    expect(expanded.changes).toContain(preExistingDropColumn);
    expect(expanded.changes).toContain(preExistingAddColumn);
    expect(
      expanded.changes.filter((change) => change instanceof DropIndex),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter((change) => change instanceof CreateIndex),
    ).toHaveLength(1);
    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      false,
    );
  });

  test("traverses retained view, trigger, and rule dependents when generated column recreation is already covered", async () => {
    const baseline = await createEmptyCatalog(150000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const mainTable = tableWithDefault("public.normalize_value(value)", {
      is_generated: true,
    });
    const branchTable = tableWithDefault("public.normalize_value(value)", {
      is_generated: true,
    });
    const mainView = viewOnItemsValue();
    const branchView = viewOnItemsValue();
    const mainTrigger = triggerOnItemsValue();
    const branchTrigger = triggerOnItemsValue();
    const mainRule = ruleOnItemsValue();
    const branchRule = ruleOnItemsValue();
    const columnId = "column:public.items.value";

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
      new AlterTableDropColumn({
        table: mainTable,
        column: mainTable.columns[0],
      }),
      new AlterTableAddColumn({
        table: branchTable,
        column: branchTable.columns[0],
      }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      tables: { [mainTable.stableId]: mainTable },
      views: { [mainView.stableId]: mainView },
      triggers: { [mainTrigger.stableId]: mainTrigger },
      rules: { [mainRule.stableId]: mainRule },
      depends: [
        {
          dependent_stable_id: columnId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
        {
          dependent_stable_id: mainView.stableId,
          referenced_stable_id: columnId,
          deptype: "n",
        },
        {
          dependent_stable_id: mainTrigger.stableId,
          referenced_stable_id: columnId,
          deptype: "n",
        },
        {
          dependent_stable_id: mainRule.stableId,
          referenced_stable_id: columnId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      tables: { [branchTable.stableId]: branchTable },
      views: { [branchView.stableId]: branchView },
      triggers: { [branchTrigger.stableId]: branchTrigger },
      rules: { [branchRule.stableId]: branchRule },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
      diffContext: {
        version: 150000,
        currentUser: "postgres",
        defaultPrivilegeState: new DefaultPrivilegeState({}),
      },
    });

    expect(
      expanded.changes.filter((change) => change instanceof DropView),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter((change) => change instanceof CreateView),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter((change) => change instanceof DropTrigger),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter((change) => change instanceof CreateTrigger),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter((change) => change instanceof DropRule),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter((change) => change instanceof CreateRule),
    ).toHaveLength(1);
    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      false,
    );
  });

  test("does not promote the owning table while traversing covered generated column recreation", async () => {
    const baseline = await createEmptyCatalog(150000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const mainTable = tableWithDefault("public.normalize_value(value)", {
      is_generated: true,
    });
    const branchTable = tableWithDefault("public.normalize_value(value)", {
      is_generated: true,
    });
    const mainIndex = indexOnItemsValue();
    const branchIndex = indexOnItemsValue();
    const columnId = "column:public.items.value";

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
      new AlterTableDropColumn({
        table: mainTable,
        column: mainTable.columns[0],
      }),
      new AlterTableAddColumn({
        table: branchTable,
        column: branchTable.columns[0],
      }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      tables: { [mainTable.stableId]: mainTable },
      indexes: { [mainIndex.stableId]: mainIndex },
      depends: [
        {
          dependent_stable_id: columnId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
        {
          dependent_stable_id: mainIndex.stableId,
          referenced_stable_id: columnId,
          deptype: "n",
        },
        {
          dependent_stable_id: mainTable.stableId,
          referenced_stable_id: columnId,
          deptype: "a",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      tables: { [branchTable.stableId]: branchTable },
      indexes: { [branchIndex.stableId]: branchIndex },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
      diffContext: {
        version: 150000,
        currentUser: "postgres",
        defaultPrivilegeState: new DefaultPrivilegeState({}),
      },
    });

    expect(
      expanded.changes.filter((change) => change instanceof DropIndex),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter((change) => change instanceof CreateIndex),
    ).toHaveLength(1);
    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      false,
    );
    expect(
      expanded.changes.some((change) => change instanceof CreateTable),
    ).toBe(false);
  });

  test("promotes retained dependents of a recreated generated column", async () => {
    const baseline = await createEmptyCatalog(150000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const mainTable = tableWithCheckConstraint("value >= 0", {
      name: "items_value_nonnegative",
      definition: "CHECK (value >= 0)",
    });
    const branchTable = tableWithCheckConstraint("value >= 0", {
      name: "items_value_nonnegative",
      definition: "CHECK (value >= 0)",
    });
    const generatedColumn = {
      is_generated: true,
      default: "public.normalize_value(value)",
    };
    mainTable.columns[0] = {
      ...mainTable.columns[0],
      ...generatedColumn,
    };
    branchTable.columns[0] = {
      ...branchTable.columns[0],
      ...generatedColumn,
    };
    const retainedExpressionIndex = {
      index_expressions: "value + 1",
      definition: "CREATE INDEX items_value_idx ON public.items ((value + 1))",
      statistics_target: [100],
    };
    const mainIndex = indexOnItemsValue({
      comment: "retained index comment",
      ...retainedExpressionIndex,
    });
    const branchIndex = indexOnItemsValue({
      comment: "retained index comment",
      ...retainedExpressionIndex,
    });
    const mainView = viewOnItemsValue();
    const branchView = viewOnItemsValue();
    const columnId = "column:public.items.value";
    const constraintId = "constraint:public.items.items_value_nonnegative";

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      tables: { [mainTable.stableId]: mainTable },
      indexes: { [mainIndex.stableId]: mainIndex },
      views: { [mainView.stableId]: mainView },
      depends: [
        {
          dependent_stable_id: columnId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
        {
          dependent_stable_id: mainIndex.stableId,
          referenced_stable_id: columnId,
          deptype: "n",
        },
        {
          dependent_stable_id: mainView.stableId,
          referenced_stable_id: columnId,
          deptype: "n",
        },
        {
          dependent_stable_id: constraintId,
          referenced_stable_id: columnId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      tables: { [branchTable.stableId]: branchTable },
      indexes: { [branchIndex.stableId]: branchIndex },
      views: { [branchView.stableId]: branchView },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
      diffContext: {
        version: 150000,
        currentUser: "postgres",
        defaultPrivilegeState: new DefaultPrivilegeState({}),
      },
    });

    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterTableDropColumn,
      ),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterTableAddColumn,
      ),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter((change) => change instanceof DropIndex),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter((change) => change instanceof CreateIndex),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter(
        (change) => change instanceof CreateCommentOnIndex,
      ),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterIndexSetStatistics,
      ),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter((change) => change instanceof DropView),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter((change) => change instanceof CreateView),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterTableDropConstraint,
      ),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterTableAddConstraint,
      ),
    ).toHaveLength(1);
    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      false,
    );
    expect(
      expanded.changes.some((change) => change instanceof CreateTable),
    ).toBe(false);
  });

  test("restores retained comments without replacing the table when walking a recreated generated column", async () => {
    const baseline = await createEmptyCatalog(150000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const mainTable = tableWithDefault("public.normalize_value(value)", {
      is_generated: true,
      comment: "computed value",
    });
    const branchTable = tableWithDefault("public.normalize_value(value)", {
      is_generated: true,
      comment: "computed value",
    });
    const columnId = "column:public.items.value";
    const commentId = `comment:${columnId}`;

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      tables: { [mainTable.stableId]: mainTable },
      depends: [
        {
          dependent_stable_id: columnId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
        {
          dependent_stable_id: commentId,
          referenced_stable_id: columnId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      tables: { [branchTable.stableId]: branchTable },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
      diffContext: {
        version: 150000,
        currentUser: "postgres",
        defaultPrivilegeState: new DefaultPrivilegeState({}),
      },
    });

    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterTableDropColumn,
      ),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterTableAddColumn,
      ),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter(
        (change) => change instanceof CreateCommentOnColumn,
      ),
    ).toHaveLength(1);
    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      false,
    );
    expect(
      expanded.changes.some((change) => change instanceof CreateTable),
    ).toBe(false);
    expect(expanded.replacedTableIds.has(mainTable.stableId)).toBe(false);
  });

  test("restores retained column grants without replacing the table when recreating a generated column", async () => {
    const baseline = await createEmptyCatalog(150000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const retainedPrivileges = [
      {
        grantee: "value_reader",
        privilege: "SELECT",
        grantable: false,
        columns: ["value"],
      },
    ];
    const mainTable = new Table({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...tableWithDefault("public.normalize_value(value)", {
        is_generated: true,
      }),
      privileges: retainedPrivileges,
    });
    const branchTable = new Table({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...tableWithDefault("public.normalize_value(value)", {
        is_generated: true,
      }),
      privileges: retainedPrivileges,
    });
    const columnId = "column:public.items.value";

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      tables: { [mainTable.stableId]: mainTable },
      depends: [
        {
          dependent_stable_id: columnId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      tables: { [branchTable.stableId]: branchTable },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
      diffContext: {
        version: 150000,
        currentUser: "postgres",
        defaultPrivilegeState: new DefaultPrivilegeState({}),
      },
    });

    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterTableDropColumn,
      ),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterTableAddColumn,
      ),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter(
        (change) => change instanceof GrantTablePrivileges,
      ),
    ).toHaveLength(1);
    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      false,
    );
    expect(
      expanded.changes.some((change) => change instanceof CreateTable),
    ).toBe(false);
    expect(expanded.replacedTableIds.has(mainTable.stableId)).toBe(false);
  });

  test("restores retained security labels without replacing the table when recreating a generated column", async () => {
    const baseline = await createEmptyCatalog(150000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const securityLabels = [{ provider: "dummy", label: "classified" }];
    const mainTable = tableWithDefault("public.normalize_value(value)", {
      is_generated: true,
      security_labels: securityLabels,
    });
    const branchTable = tableWithDefault("public.normalize_value(value)", {
      is_generated: true,
      security_labels: securityLabels,
    });
    const columnId = "column:public.items.value";
    const securityLabelId =
      "securityLabel:column:public.items.value::provider:dummy";

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      tables: { [mainTable.stableId]: mainTable },
      depends: [
        {
          dependent_stable_id: columnId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
        {
          dependent_stable_id: securityLabelId,
          referenced_stable_id: columnId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      tables: { [branchTable.stableId]: branchTable },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
      diffContext: {
        version: 150000,
        currentUser: "postgres",
        defaultPrivilegeState: new DefaultPrivilegeState({}),
      },
    });

    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterTableDropColumn,
      ),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterTableAddColumn,
      ),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter(
        (change) => change instanceof CreateSecurityLabelOnColumn,
      ),
    ).toHaveLength(1);
    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      false,
    );
    expect(
      expanded.changes.some((change) => change instanceof CreateTable),
    ).toBe(false);
    expect(expanded.replacedTableIds.has(mainTable.stableId)).toBe(false);
  });

  test("restores retained metadata when generated column recreation is already covered", async () => {
    const baseline = await createEmptyCatalog(150000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const securityLabels = [{ provider: "dummy", label: "classified" }];
    const mainTable = tableWithDefault("public.normalize_value(value)", {
      is_generated: true,
      comment: "computed value",
      security_labels: securityLabels,
    });
    const branchTable = tableWithDefault("public.normalize_value(value)", {
      is_generated: true,
      comment: "computed value",
      security_labels: securityLabels,
    });
    const columnId = "column:public.items.value";
    const commentId = `comment:${columnId}`;
    const securityLabelId =
      "securityLabel:column:public.items.value::provider:dummy";
    const preExistingDropColumn = new AlterTableDropColumn({
      table: mainTable,
      column: mainTable.columns[0],
    });
    const preExistingAddColumn = new AlterTableAddColumn({
      table: branchTable,
      column: branchTable.columns[0],
    });

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
      preExistingDropColumn,
      preExistingAddColumn,
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      tables: { [mainTable.stableId]: mainTable },
      depends: [
        {
          dependent_stable_id: columnId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
        {
          dependent_stable_id: commentId,
          referenced_stable_id: columnId,
          deptype: "n",
        },
        {
          dependent_stable_id: securityLabelId,
          referenced_stable_id: columnId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      tables: { [branchTable.stableId]: branchTable },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
      diffContext: {
        version: 150000,
        currentUser: "postgres",
        defaultPrivilegeState: new DefaultPrivilegeState({}),
      },
    });

    expect(expanded.changes).toContain(preExistingDropColumn);
    expect(expanded.changes).toContain(preExistingAddColumn);
    expect(
      expanded.changes.filter(
        (change) => change instanceof CreateCommentOnColumn,
      ),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter(
        (change) => change instanceof CreateSecurityLabelOnColumn,
      ),
    ).toHaveLength(1);
    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      false,
    );
    expect(expanded.replacedTableIds.has(mainTable.stableId)).toBe(false);
  });

  test("replays retained index, trigger, and rule metadata after generated column fallback", async () => {
    const baseline = await createEmptyCatalog(150000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const mainTable = tableWithDefault("public.normalize_value(value)", {
      is_generated: true,
    });
    const branchTable = tableWithDefault("public.normalize_value(value)", {
      is_generated: true,
    });
    const mainIndex = indexOnItemsValue({ is_clustered: true });
    const branchIndex = indexOnItemsValue({ is_clustered: true });
    const mainTrigger = triggerOnItemsValue({ enabled: "D" });
    const branchTrigger = triggerOnItemsValue({ enabled: "D" });
    const mainRule = ruleOnItemsValue({ enabled: "R" });
    const branchRule = ruleOnItemsValue({ enabled: "R" });
    const columnId = "column:public.items.value";

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      tables: { [mainTable.stableId]: mainTable },
      indexes: { [mainIndex.stableId]: mainIndex },
      triggers: { [mainTrigger.stableId]: mainTrigger },
      rules: { [mainRule.stableId]: mainRule },
      depends: [
        {
          dependent_stable_id: columnId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
        {
          dependent_stable_id: mainIndex.stableId,
          referenced_stable_id: columnId,
          deptype: "n",
        },
        {
          dependent_stable_id: mainTrigger.stableId,
          referenced_stable_id: columnId,
          deptype: "n",
        },
        {
          dependent_stable_id: mainRule.stableId,
          referenced_stable_id: columnId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      tables: { [branchTable.stableId]: branchTable },
      indexes: { [branchIndex.stableId]: branchIndex },
      triggers: { [branchTrigger.stableId]: branchTrigger },
      rules: { [branchRule.stableId]: branchRule },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
      diffContext: {
        version: 150000,
        currentUser: "postgres",
        defaultPrivilegeState: new DefaultPrivilegeState({}),
      },
    });
    const serialized = expanded.changes.map((change) => change.serialize());

    expect(serialized).toContain(
      "ALTER TABLE public.items CLUSTER ON items_value_idx",
    );
    expect(serialized).toContain(
      "ALTER TABLE public.items DISABLE TRIGGER items_value_trigger",
    );
    expect(serialized).toContain(
      "ALTER TABLE public.items ENABLE REPLICA RULE items_value_rule",
    );
  });

  test("restores clustered indexes on promoted materialized views", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const mainMaterializedView = materializedViewOnItemsValue({
      definition:
        " SELECT public.normalize_value(items.value) AS value FROM public.items;",
    });
    const branchMaterializedView = materializedViewOnItemsValue({
      definition:
        " SELECT public.normalize_value(items.value) AS value FROM public.items;",
    });
    const mainIndex = indexOnItemsValue({
      table_name: "items_value_mv",
      name: "items_value_mv_value_idx",
      table_relkind: "m",
      is_clustered: true,
      definition:
        "CREATE INDEX items_value_mv_value_idx ON public.items_value_mv (value)",
    });
    const branchIndex = indexOnItemsValue({
      table_name: "items_value_mv",
      name: "items_value_mv_value_idx",
      table_relkind: "m",
      is_clustered: true,
      definition:
        "CREATE INDEX items_value_mv_value_idx ON public.items_value_mv (value)",
    });

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      materializedViews: {
        [mainMaterializedView.stableId]: mainMaterializedView,
      },
      indexableObjects: {
        [mainMaterializedView.stableId]: mainMaterializedView,
      },
      indexes: { [mainIndex.stableId]: mainIndex },
      depends: [
        {
          dependent_stable_id: mainMaterializedView.stableId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      materializedViews: {
        [branchMaterializedView.stableId]: branchMaterializedView,
      },
      indexableObjects: {
        [branchMaterializedView.stableId]: branchMaterializedView,
      },
      indexes: { [branchIndex.stableId]: branchIndex },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });
    const serialized = expanded.changes.map((change) => change.serialize());

    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterMaterializedViewClusterOn,
      ),
    ).toHaveLength(1);
    expect(serialized).toContain(
      "ALTER MATERIALIZED VIEW public.items_value_mv CLUSTER ON items_value_mv_value_idx",
    );
  });

  test("restores retained indexes when materialized views are already replace roots", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainMaterializedView = materializedViewOnItemsValue({
      definition: " SELECT items.value AS value FROM public.items;",
    });
    const branchMaterializedView = materializedViewOnItemsValue({
      definition: " SELECT items.value + 1 AS value FROM public.items;",
    });
    const mainIndex = indexOnItemsValue({
      table_name: "items_value_mv",
      name: "items_value_mv_value_idx",
      table_relkind: "m",
      is_clustered: true,
      definition:
        "CREATE INDEX items_value_mv_value_idx ON public.items_value_mv (value)",
    });
    const branchIndex = indexOnItemsValue({
      table_name: "items_value_mv",
      name: "items_value_mv_value_idx",
      table_relkind: "m",
      is_clustered: true,
      definition:
        "CREATE INDEX items_value_mv_value_idx ON public.items_value_mv (value)",
    });

    const changes: Change[] = [
      new DropMaterializedView({ materializedView: mainMaterializedView }),
      new CreateMaterializedView({
        materializedView: branchMaterializedView,
      }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      materializedViews: {
        [mainMaterializedView.stableId]: mainMaterializedView,
      },
      indexableObjects: {
        [mainMaterializedView.stableId]: mainMaterializedView,
      },
      indexes: { [mainIndex.stableId]: mainIndex },
      depends: [],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      materializedViews: {
        [branchMaterializedView.stableId]: branchMaterializedView,
      },
      indexableObjects: {
        [branchMaterializedView.stableId]: branchMaterializedView,
      },
      indexes: { [branchIndex.stableId]: branchIndex },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });
    const serialized = expanded.changes.map((change) => change.serialize());

    expect(
      expanded.changes.filter((change) => change instanceof DropIndex),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter((change) => change instanceof CreateIndex),
    ).toHaveLength(1);
    expect(serialized).toContain(
      "ALTER MATERIALIZED VIEW public.items_value_mv CLUSTER ON items_value_mv_value_idx",
    );
  });

  test("skips partition-cloned trigger dependents during routine replacement", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const partitionClone = {
      schema: "public",
      table_name: "items_2026",
      is_partition_clone: true,
      parent_trigger_name: "items_value_trigger",
      parent_table_schema: "public",
      parent_table_name: "items",
    };
    const mainTrigger = triggerOnItemsValue(partitionClone);
    const branchTrigger = triggerOnItemsValue(partitionClone);
    const mainTable = partitionTableWithDefault(null);
    const branchTable = partitionTableWithDefault(null);

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      tables: { [mainTable.stableId]: mainTable },
      triggers: { [mainTrigger.stableId]: mainTrigger },
      depends: [
        {
          dependent_stable_id: mainTrigger.stableId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      tables: { [branchTable.stableId]: branchTable },
      triggers: { [branchTrigger.stableId]: branchTrigger },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(
      expanded.changes.some((change) => change.objectType === "trigger"),
    ).toBe(false);
  });

  test("replaces child partitions instead of dropping generated columns on them", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const mainTable = partitionTableWithDefault(
      "public.normalize_value(value)",
      {
        is_generated: true,
      },
    );
    const branchTable = partitionTableWithDefault(
      "public.normalize_value(value)",
      {
        is_generated: true,
      },
    );
    const columnId = "column:public.items_2026.value";

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      tables: { [mainTable.stableId]: mainTable },
      depends: [
        {
          dependent_stable_id: columnId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      tables: { [branchTable.stableId]: branchTable },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
      diffContext: {
        version: 170000,
        currentUser: "postgres",
        defaultPrivilegeState: new DefaultPrivilegeState({}),
      },
    });
    const serialized = expanded.changes.map((change) => change.serialize());

    expect(
      expanded.changes.filter(
        (change) =>
          change instanceof AlterTableDropColumn &&
          change.table.name === "items_2026",
      ),
    ).toHaveLength(0);
    expect(
      expanded.changes.filter(
        (change) =>
          change instanceof AlterTableAddColumn &&
          change.table.name === "items_2026",
      ),
    ).toHaveLength(0);
    expect(
      expanded.changes.filter(
        (change) =>
          change instanceof DropTable && change.table.name === "items_2026",
      ),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter(
        (change) =>
          change instanceof CreateTable && change.table.name === "items_2026",
      ),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterTableAlterColumnSetDefault,
      ),
    ).toHaveLength(0);
    expect(serialized).toContain(
      "CREATE TABLE public.items_2026 PARTITION OF public.items (value GENERATED ALWAYS AS (public.normalize_value(value)) STORED) FOR VALUES FROM (2026) TO (2027)",
    );
    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      true,
    );
  });

  test("refreshes each publication table entry when recreating generated columns", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const mainItems = tableNamedWithDefault(
      "items",
      "public.normalize_value(value)",
      { is_generated: true },
    );
    const branchItems = tableNamedWithDefault(
      "items",
      "public.normalize_value(value)",
      { is_generated: true },
    );
    const mainWidgets = tableNamedWithDefault(
      "widgets",
      "public.normalize_value(value)",
      { is_generated: true },
    );
    const branchWidgets = tableNamedWithDefault(
      "widgets",
      "public.normalize_value(value)",
      { is_generated: true },
    );
    const mainPublication = publicationOnTables([
      {
        schema: "public",
        name: "items",
        columns: ["value"],
        row_filter: null,
      },
      {
        schema: "public",
        name: "widgets",
        columns: ["value"],
        row_filter: null,
      },
    ]);
    const branchPublication = publicationOnTables([
      {
        schema: "public",
        name: "items",
        columns: ["value"],
        row_filter: null,
      },
      {
        schema: "public",
        name: "widgets",
        columns: ["value"],
        row_filter: null,
      },
    ]);
    const itemColumnId = "column:public.items.value";
    const widgetColumnId = "column:public.widgets.value";

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      publications: { [mainPublication.stableId]: mainPublication },
      tables: {
        [mainItems.stableId]: mainItems,
        [mainWidgets.stableId]: mainWidgets,
      },
      depends: [
        {
          dependent_stable_id: itemColumnId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
        {
          dependent_stable_id: widgetColumnId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
        {
          dependent_stable_id: mainPublication.stableId,
          referenced_stable_id: itemColumnId,
          deptype: "n",
        },
        {
          dependent_stable_id: mainPublication.stableId,
          referenced_stable_id: widgetColumnId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      publications: { [branchPublication.stableId]: branchPublication },
      tables: {
        [branchItems.stableId]: branchItems,
        [branchWidgets.stableId]: branchWidgets,
      },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });
    const serialized = expanded.changes.map((change) => change.serialize());

    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterPublicationDropTables,
      ),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterPublicationAddTables,
      ),
    ).toHaveLength(1);
    expect(serialized).toContain(
      "ALTER PUBLICATION items_pub DROP TABLE public.items, public.widgets",
    );
    expect(serialized).toContain(
      "ALTER PUBLICATION items_pub ADD TABLE public.items (value), TABLE public.widgets (value)",
    );
  });

  test("releases retained publication row filters before routine replacement", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const mainPublication = publicationOnItemsValue(
      "(public.normalize_value(value) > 0)",
    );
    const branchPublication = publicationOnItemsValue(
      "(public.normalize_value(value) > 0)",
    );
    const table = tableWithDefault(null);

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      publications: { [mainPublication.stableId]: mainPublication },
      tables: { [table.stableId]: table },
      depends: [
        {
          dependent_stable_id: mainPublication.stableId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      publications: { [branchPublication.stableId]: branchPublication },
      tables: { [table.stableId]: table },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterPublicationDropTables,
      ),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterPublicationAddTables,
      ),
    ).toHaveLength(1);
  });

  test("refreshes publication row filters that depend on recreated generated columns without column lists", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const mainTable = tableWithDefault("public.normalize_value(value)", {
      is_generated: true,
    });
    const branchTable = tableWithDefault("public.normalize_value(value)", {
      is_generated: true,
    });
    const mainPublication = publicationOnItemsValue("(value > 0)");
    const branchPublication = publicationOnItemsValue("(value > 0)");
    const columnId = "column:public.items.value";

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      publications: { [mainPublication.stableId]: mainPublication },
      tables: { [mainTable.stableId]: mainTable },
      depends: [
        {
          dependent_stable_id: columnId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
        {
          dependent_stable_id: mainPublication.stableId,
          referenced_stable_id: columnId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      publications: { [branchPublication.stableId]: branchPublication },
      tables: { [branchTable.stableId]: branchTable },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });
    const serialized = expanded.changes.map((change) => change.serialize());

    expect(serialized).toContain(
      "ALTER PUBLICATION items_pub DROP TABLE public.items",
    );
    expect(serialized).toContain(
      "ALTER PUBLICATION items_pub ADD TABLE public.items WHERE (value > 0)",
    );
  });

  test("does not duplicate existing publication row filter replacements", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const mainPublication = publicationOnItemsValue(
      "(public.normalize_value(value) > 0)",
    );
    const branchPublication = publicationOnItemsValue(
      "(public.normalize_value(value) >= 0)",
    );
    const table = tableWithDefault(null);

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
      new AlterPublicationDropTables({
        publication: mainPublication,
        tables: mainPublication.tables,
      }),
      new AlterPublicationAddTables({
        publication: branchPublication,
        tables: branchPublication.tables,
      }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      publications: { [mainPublication.stableId]: mainPublication },
      tables: { [table.stableId]: table },
      depends: [
        {
          dependent_stable_id: mainPublication.stableId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      publications: { [branchPublication.stableId]: branchPublication },
      tables: { [table.stableId]: table },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterPublicationDropTables,
      ),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterPublicationAddTables,
      ),
    ).toHaveLength(1);
  });

  test("does not duplicate existing publication column list replacements", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const mainTable = tableWithDefault("public.normalize_value(value)", {
      is_generated: true,
    });
    const branchTable = tableWithDefault("public.normalize_value(value)", {
      is_generated: true,
    });
    const mainPublication = publicationOnTables([
      {
        schema: "public",
        name: "items",
        columns: ["value"],
        row_filter: null,
      },
    ]);
    const branchPublication = publicationOnTables([
      {
        schema: "public",
        name: "items",
        columns: ["value"],
        row_filter: null,
      },
    ]);
    const columnId = "column:public.items.value";

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
      new AlterPublicationDropTables({
        publication: mainPublication,
        tables: mainPublication.tables,
      }),
      new AlterPublicationAddTables({
        publication: branchPublication,
        tables: branchPublication.tables,
      }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      publications: { [mainPublication.stableId]: mainPublication },
      tables: { [mainTable.stableId]: mainTable },
      depends: [
        {
          dependent_stable_id: columnId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
        {
          dependent_stable_id: mainPublication.stableId,
          referenced_stable_id: columnId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      publications: { [branchPublication.stableId]: branchPublication },
      tables: { [branchTable.stableId]: branchTable },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterPublicationDropTables,
      ),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterPublicationAddTables,
      ),
    ).toHaveLength(1);
  });

  test("does not duplicate publication table entries when row filter and column list both need refresh", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const mainTable = tableWithDefault("public.normalize_value(value)", {
      is_generated: true,
    });
    const branchTable = tableWithDefault("public.normalize_value(value)", {
      is_generated: true,
    });
    const mainPublication = publicationOnTables([
      {
        schema: "public",
        name: "items",
        columns: ["value"],
        row_filter: "(public.normalize_value(value) > 0)",
      },
    ]);
    const branchPublication = publicationOnTables([
      {
        schema: "public",
        name: "items",
        columns: ["value"],
        row_filter: "(public.normalize_value(value) > 0)",
      },
    ]);
    const columnId = "column:public.items.value";

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      publications: { [mainPublication.stableId]: mainPublication },
      tables: { [mainTable.stableId]: mainTable },
      depends: [
        {
          dependent_stable_id: mainPublication.stableId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
        {
          dependent_stable_id: columnId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
        {
          dependent_stable_id: mainPublication.stableId,
          referenced_stable_id: columnId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      publications: { [branchPublication.stableId]: branchPublication },
      tables: { [branchTable.stableId]: branchTable },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });
    const serialized = expanded.changes.map((change) => change.serialize());

    expect(
      serialized.filter((statement) =>
        statement.startsWith("ALTER PUBLICATION items_pub DROP TABLE"),
      ),
    ).toEqual(["ALTER PUBLICATION items_pub DROP TABLE public.items"]);
    expect(
      serialized.filter((statement) =>
        statement.startsWith("ALTER PUBLICATION items_pub ADD TABLE"),
      ),
    ).toEqual([
      "ALTER PUBLICATION items_pub ADD TABLE public.items (value) WHERE (public.normalize_value(value) > 0)",
    ]);
  });

  test("handles aggregate replacements as expression roots", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainAggregate = aggregateWithArgs(["integer"]);
    const branchAggregate = aggregateWithArgs(["bigint"]);
    const mainTable = tableWithDefault("public.total_value(value)");
    const branchTable = tableWithDefault("public.total_value(value::bigint)");
    const columnId = "column:public.items.value";

    const changes: Change[] = [
      new DropAggregate({ aggregate: mainAggregate }),
      new CreateAggregate({ aggregate: branchAggregate }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      aggregates: { [mainAggregate.stableId]: mainAggregate },
      tables: { [mainTable.stableId]: mainTable },
      depends: [
        {
          dependent_stable_id: columnId,
          referenced_stable_id: mainAggregate.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      aggregates: { [branchAggregate.stableId]: branchAggregate },
      tables: { [branchTable.stableId]: branchTable },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterTableAlterColumnDropDefault,
      ),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterTableAlterColumnSetDefault,
      ),
    ).toHaveLength(1);
    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      false,
    );
  });

  test("recreates retained aggregates that depend on replaced routines", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"], "sum_state");
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.sum_state(renamed integer) RETURNS integer",
    });
    const mainAggregate = aggregateWithArgs(["integer"]);
    const branchAggregate = aggregateWithArgs(["integer"]);

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      aggregates: { [mainAggregate.stableId]: mainAggregate },
      depends: [
        {
          dependent_stable_id: mainAggregate.stableId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      aggregates: { [branchAggregate.stableId]: branchAggregate },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(
      expanded.changes.filter((change) => change instanceof DropAggregate),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter((change) => change instanceof CreateAggregate),
    ).toHaveLength(1);
  });

  test("restores aggregate metadata when an existing aggregate create is converted from orReplace", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"], "sum_state");
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.sum_state(renamed integer) RETURNS integer",
    });
    const mainAggregate = aggregateWithArgs(["integer"]);
    const branchAggregate = aggregateWithArgs(["integer"], {
      owner: "aggregate_owner",
      comment: "aggregate comment",
      security_labels: [{ provider: "dummy", label: "aggregate label" }],
      privileges: [
        {
          grantee: "aggregate_executor",
          privilege: "EXECUTE",
          grantable: false,
        },
      ],
    });

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
      new CreateAggregate({ aggregate: branchAggregate, orReplace: true }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      aggregates: { [mainAggregate.stableId]: mainAggregate },
      depends: [
        {
          dependent_stable_id: mainAggregate.stableId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      aggregates: { [branchAggregate.stableId]: branchAggregate },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
      diffContext: {
        version: 170000,
        currentUser: "postgres",
        defaultPrivilegeState: new DefaultPrivilegeState({}),
      },
    });
    const serialized = expanded.changes.map((change) => change.serialize());

    expect(
      expanded.changes.filter((change) => change instanceof DropAggregate),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterAggregateChangeOwner,
      ),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter(
        (change) => change instanceof CreateCommentOnAggregate,
      ),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter(
        (change) => change instanceof CreateSecurityLabelOnAggregate,
      ),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter(
        (change) => change instanceof GrantAggregatePrivileges,
      ),
    ).toHaveLength(1);
    expect(serialized).toContain(
      "ALTER AGGREGATE public.total_value(integer) OWNER TO aggregate_owner",
    );
    expect(serialized).toContain(
      "COMMENT ON AGGREGATE public.total_value(integer) IS 'aggregate comment'",
    );
    expect(serialized).toContain(
      "SECURITY LABEL FOR dummy ON AGGREGATE public.total_value(integer) IS 'aggregate label'",
    );
    expect(serialized).toContain(
      "GRANT ALL ON FUNCTION public.total_value(integer) TO aggregate_executor",
    );
  });

  test("restores promoted routine metadata after dependent routine replacement", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = procedureWithArgs(["bigint"]);
    const mainDependent = procedureWithArgs(["integer"], "uses_normalize");
    const branchDependent = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainDependent,
      owner: "routine_owner",
      comment: "dependent routine comment",
      security_labels: [{ provider: "dummy", label: "routine label" }],
      privileges: [
        {
          grantee: "routine_executor",
          privilege: "EXECUTE",
          grantable: false,
        },
      ],
    });

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: {
        [mainProcedure.stableId]: mainProcedure,
        [mainDependent.stableId]: mainDependent,
      },
      depends: [
        {
          dependent_stable_id: mainDependent.stableId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: {
        [branchProcedure.stableId]: branchProcedure,
        [branchDependent.stableId]: branchDependent,
      },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
      diffContext: {
        version: 170000,
        currentUser: "postgres",
        defaultPrivilegeState: new DefaultPrivilegeState({}),
      },
    });
    const serialized = expanded.changes.map((change) => change.serialize());

    expect(serialized).toContain(
      "ALTER FUNCTION public.uses_normalize(integer) OWNER TO routine_owner",
    );
    expect(serialized).toContain(
      "COMMENT ON FUNCTION public.uses_normalize(integer) IS 'dependent routine comment'",
    );
    expect(serialized).toContain(
      "SECURITY LABEL FOR dummy ON FUNCTION public.uses_normalize(integer) IS 'routine label'",
    );
    expect(serialized).toContain(
      "GRANT ALL ON FUNCTION public.uses_normalize(integer) TO routine_executor",
    );
  });

  test("restores procedure metadata when an existing procedure create is converted from orReplace", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = procedureWithArgs(["bigint"]);
    const mainDependent = procedureWithArgs(["integer"], "uses_normalize");
    const branchDependent = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainDependent,
      source_code: "SELECT public.normalize_value(arg1::bigint)",
      definition:
        "CREATE FUNCTION public.uses_normalize(arg1 integer) RETURNS integer",
      owner: "routine_owner",
      comment: "dependent routine comment",
      security_labels: [{ provider: "dummy", label: "routine label" }],
      privileges: [
        {
          grantee: "routine_executor",
          privilege: "EXECUTE",
          grantable: false,
        },
      ],
    });

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
      new CreateProcedure({ procedure: branchDependent, orReplace: true }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: {
        [mainProcedure.stableId]: mainProcedure,
        [mainDependent.stableId]: mainDependent,
      },
      depends: [
        {
          dependent_stable_id: mainDependent.stableId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: {
        [branchProcedure.stableId]: branchProcedure,
        [branchDependent.stableId]: branchDependent,
      },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
      diffContext: {
        version: 170000,
        currentUser: "postgres",
        defaultPrivilegeState: new DefaultPrivilegeState({}),
      },
    });
    const serialized = expanded.changes.map((change) => change.serialize());

    expect(serialized).toContain(
      "DROP FUNCTION public.uses_normalize(arg1 integer)",
    );
    expect(serialized).toContain(
      "CREATE OR REPLACE FUNCTION public.uses_normalize(arg1 integer) RETURNS integer",
    );
    expect(serialized).toContain(
      "ALTER FUNCTION public.uses_normalize(integer) OWNER TO routine_owner",
    );
    expect(serialized).toContain(
      "COMMENT ON FUNCTION public.uses_normalize(integer) IS 'dependent routine comment'",
    );
    expect(serialized).toContain(
      "SECURITY LABEL FOR dummy ON FUNCTION public.uses_normalize(integer) IS 'routine label'",
    );
    expect(serialized).toContain(
      "GRANT ALL ON FUNCTION public.uses_normalize(integer) TO routine_executor",
    );
  });

  test("replays retained table metadata for promoted table replacements", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = procedureWithArgs(["bigint"]);
    const tableSecurityLabels = [{ provider: "dummy", label: "table label" }];
    const columnSecurityLabels = [{ provider: "dummy", label: "column label" }];
    const retainedPrivileges = [
      {
        grantee: "table_reader",
        privilege: "SELECT",
        grantable: false,
      },
    ];
    const mainTable = new Table({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...tableWithDefault("public.normalize_value(value)", {
        comment: "value column",
        security_labels: columnSecurityLabels,
      }),
      owner: "app_owner",
      row_security: true,
      force_row_security: true,
      replica_identity: "f",
      comment: "retained table comment",
      privileges: retainedPrivileges,
      security_labels: tableSecurityLabels,
    });
    const branchTable = new Table({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainTable,
    });

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      tables: { [mainTable.stableId]: mainTable },
      depends: [
        {
          dependent_stable_id: mainTable.stableId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      tables: { [branchTable.stableId]: branchTable },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
      diffContext: {
        version: 170000,
        currentUser: "postgres",
        defaultPrivilegeState: new DefaultPrivilegeState({}),
      },
    });

    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      true,
    );
    expect(
      expanded.changes.some((change) => change instanceof CreateTable),
    ).toBe(true);
    expect(
      expanded.changes.some(
        (change) => change instanceof AlterTableChangeOwner,
      ),
    ).toBe(true);
    expect(
      expanded.changes.some(
        (change) => change instanceof AlterTableEnableRowLevelSecurity,
      ),
    ).toBe(true);
    expect(
      expanded.changes.some(
        (change) => change instanceof AlterTableForceRowLevelSecurity,
      ),
    ).toBe(true);
    expect(
      expanded.changes.some(
        (change) => change instanceof AlterTableSetReplicaIdentity,
      ),
    ).toBe(true);
    expect(
      expanded.changes.some((change) => change instanceof CreateCommentOnTable),
    ).toBe(true);
    expect(
      expanded.changes.some(
        (change) => change instanceof CreateCommentOnColumn,
      ),
    ).toBe(true);
    expect(
      expanded.changes.some(
        (change) => change instanceof CreateSecurityLabelOnTable,
      ),
    ).toBe(true);
    expect(
      expanded.changes.some(
        (change) => change instanceof CreateSecurityLabelOnColumn,
      ),
    ).toBe(true);
    expect(
      expanded.changes.some((change) => change instanceof GrantTablePrivileges),
    ).toBe(true);
  });

  test("replays retained owned sequences for promoted table replacements", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = procedureWithArgs(["bigint"]);
    const columnDefault = "nextval('public.items_value_seq'::regclass)";
    const mainTable = tableWithDefault(columnDefault);
    const branchTable = tableWithDefault(columnDefault);
    const mainSequence = sequenceOwnedByItemsValue();
    const branchSequence = sequenceOwnedByItemsValue();

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      tables: { [mainTable.stableId]: mainTable },
      sequences: { [mainSequence.stableId]: mainSequence },
      depends: [
        {
          dependent_stable_id: mainTable.stableId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      tables: { [branchTable.stableId]: branchTable },
      sequences: { [branchSequence.stableId]: branchSequence },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
      diffContext: {
        version: 170000,
        currentUser: "postgres",
        defaultPrivilegeState: new DefaultPrivilegeState({}),
      },
    });

    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      true,
    );
    expect(
      expanded.changes.some((change) => change instanceof CreateTable),
    ).toBe(true);
    expect(
      expanded.changes.some((change) => change instanceof CreateSequence),
    ).toBe(true);
    expect(
      expanded.changes.some(
        (change) => change instanceof AlterSequenceSetOwnedBy,
      ),
    ).toBe(true);
    expect(
      expanded.changes.some(
        (change) => change instanceof AlterTableAlterColumnSetDefault,
      ),
    ).toBe(true);
  });

  test("does not count domain constraints as domain default restores", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const mainDomain = domainWithDefault("public.normalize_value(1)");
    const branchDomain = new Domain({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...domainWithConstraint("VALUE > 0"),
      default_bin: mainDomain.default_bin,
      default_value: mainDomain.default_value,
    });
    const tableUsingDomain = tableWithDefault(null, {
      data_type: "item_value",
      data_type_str: "public.item_value",
      is_custom_type: true,
      custom_type_type: "d",
      custom_type_category: "N",
      custom_type_schema: "public",
      custom_type_name: "item_value",
    });
    const addConstraint = new AlterDomainAddConstraint({
      domain: branchDomain,
      constraint: branchDomain.constraints[0] as Domain["constraints"][number],
    });

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
      addConstraint,
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      domains: { [mainDomain.stableId]: mainDomain },
      tables: { [tableUsingDomain.stableId]: tableUsingDomain },
      depends: [
        {
          dependent_stable_id: mainDomain.stableId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
        {
          dependent_stable_id: "column:public.items.value",
          referenced_stable_id: mainDomain.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      domains: { [branchDomain.stableId]: branchDomain },
      tables: { [tableUsingDomain.stableId]: tableUsingDomain },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(expanded.changes).toContain(addConstraint);
    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterDomainDropDefault,
      ),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterDomainSetDefault,
      ),
    ).toHaveLength(1);
    expect(
      expanded.changes.some((change) => change instanceof DropDomain),
    ).toBe(false);
    expect(
      expanded.changes.some((change) => change instanceof CreateDomain),
    ).toBe(false);
  });

  test("replays retained publication membership for promoted table replacements", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = procedureWithArgs(["bigint"]);
    const mainTable = tableWithDefault("public.normalize_value(value)");
    const branchTable = tableWithDefault("public.normalize_value(value)");
    const mainPublication = publicationOnTables([
      {
        schema: "public",
        name: "items",
        columns: null,
        row_filter: null,
      },
    ]);
    const branchPublication = publicationOnTables([
      {
        schema: "public",
        name: "items",
        columns: null,
        row_filter: null,
      },
    ]);

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      tables: { [mainTable.stableId]: mainTable },
      publications: { [mainPublication.stableId]: mainPublication },
      depends: [
        {
          dependent_stable_id: mainTable.stableId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      tables: { [branchTable.stableId]: branchTable },
      publications: { [branchPublication.stableId]: branchPublication },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      true,
    );
    expect(
      expanded.changes.some((change) => change instanceof CreateTable),
    ).toBe(true);
    expect(
      expanded.changes.some(
        (change) => change instanceof AlterPublicationAddTables,
      ),
    ).toBe(true);
  });

  test("orders constraint-backed replica identity after promoted table constraints", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = procedureWithArgs(["bigint"]);
    const mainTable = tableWithUniqueConstraint({
      replica_identity: "i",
      replica_identity_index: "items_value_key",
    });
    const branchTable = tableWithUniqueConstraint({
      replica_identity: "i",
      replica_identity_index: "items_value_key",
    });

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      tables: { [mainTable.stableId]: mainTable },
      depends: [
        {
          dependent_stable_id: mainTable.stableId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      tables: { [branchTable.stableId]: branchTable },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
      diffContext: {
        version: 170000,
        currentUser: "postgres",
        defaultPrivilegeState: new DefaultPrivilegeState({}),
      },
    });
    const addConstraint = expanded.changes.find(
      (change) => change instanceof AlterTableAddConstraint,
    );
    const sorted = sortChanges(
      { mainCatalog, branchCatalog },
      expanded.changes,
    );
    const addConstraintIndex = sorted.findIndex(
      (change) => change instanceof AlterTableAddConstraint,
    );
    const replicaIdentityIndex = sorted.findIndex(
      (change) => change instanceof AlterTableSetReplicaIdentity,
    );

    expect(addConstraint).toBeInstanceOf(AlterTableAddConstraint);
    expect(addConstraint?.creates).toContain(
      "index:public.items.items_value_key",
    );
    expect(replicaIdentityIndex).toBeGreaterThan(addConstraintIndex);
  });

  test("treats publication recreation as row-filter replacement coverage", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = procedureWithArgs(["bigint"]);
    const mainTable = tableWithDefault("public.normalize_value(value)");
    const branchTable = tableWithDefault("public.normalize_value(value)");
    const mainPublication = publicationOnItemsValue(
      "(public.normalize_value(value) > 0)",
    );
    const branchPublication = publicationOnItemsValue(
      "(public.normalize_value(value) > 0)",
    );

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
      new DropPublication({ publication: mainPublication }),
      new CreatePublication({ publication: branchPublication }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      tables: { [mainTable.stableId]: mainTable },
      publications: { [mainPublication.stableId]: mainPublication },
      depends: [
        {
          dependent_stable_id: mainPublication.stableId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      tables: { [branchTable.stableId]: branchTable },
      publications: { [branchPublication.stableId]: branchPublication },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterPublicationDropTables,
      ),
    ).toHaveLength(0);
    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterPublicationAddTables,
      ),
    ).toHaveLength(0);
  });

  test("keeps owned sequence metadata for promoted table cycle filtering", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = procedureWithArgs(["bigint"]);
    const columnDefault = "nextval('public.items_value_seq'::regclass)";
    const mainTable = tableWithDefault(columnDefault);
    const branchTable = tableWithDefault(columnDefault);
    const mainSequence = sequenceOwnedByItemsValue();
    const branchSequence = sequenceOwnedByItemsValue();
    const sequenceId = "sequence:public.items_value_seq";
    const columnId = "column:public.items.value";

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      tables: { [mainTable.stableId]: mainTable },
      sequences: { [mainSequence.stableId]: mainSequence },
      depends: [
        {
          dependent_stable_id: mainTable.stableId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      tables: { [branchTable.stableId]: branchTable },
      sequences: { [branchSequence.stableId]: branchSequence },
      depends: [
        {
          dependent_stable_id: columnId,
          referenced_stable_id: sequenceId,
          deptype: "n",
        },
        {
          dependent_stable_id: sequenceId,
          referenced_stable_id: columnId,
          deptype: "a",
        },
      ],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
      diffContext: {
        version: 170000,
        currentUser: "postgres",
        defaultPrivilegeState: new DefaultPrivilegeState({}),
      },
    });
    const createSequence = expanded.changes.find(
      (change): change is CreateSequence => change instanceof CreateSequence,
    );

    expect(createSequence?.sequence.owned_by_schema).toBe("public");
    expect(createSequence?.sequence.owned_by_table).toBe("items");
    expect(createSequence?.sequence.owned_by_column).toBe("value");
    expect(() =>
      sortChanges({ mainCatalog, branchCatalog }, expanded.changes),
    ).not.toThrow();
  });

  test("restores clustering for retained constraint-backed indexes on promoted tables", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = procedureWithArgs(["bigint"]);
    const mainTable = tableWithUniqueConstraint();
    const branchTable = tableWithUniqueConstraint();
    const mainIndex = constraintBackedIndexOnItemsValue({ is_clustered: true });
    const branchIndex = constraintBackedIndexOnItemsValue({
      is_clustered: true,
    });

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      tables: { [mainTable.stableId]: mainTable },
      indexes: { [mainIndex.stableId]: mainIndex },
      depends: [
        {
          dependent_stable_id: mainTable.stableId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      tables: { [branchTable.stableId]: branchTable },
      indexes: { [branchIndex.stableId]: branchIndex },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
      diffContext: {
        version: 170000,
        currentUser: "postgres",
        defaultPrivilegeState: new DefaultPrivilegeState({}),
      },
    });

    expect(
      expanded.changes.some((change) => change instanceof AlterTableClusterOn),
    ).toBe(true);
  });

  test("synthesizes a table check constraint replacement for an unchanged expression that depends on a replaced procedure", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const mainTable = tableWithCheckConstraint(
      "public.normalize_value(value) > 0",
    );
    const branchTable = tableWithCheckConstraint(
      "public.normalize_value(value) > 0",
    );

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      tables: { [mainTable.stableId]: mainTable },
      depends: [
        {
          dependent_stable_id: "constraint:public.items.items_value_check",
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      tables: { [branchTable.stableId]: branchTable },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(
      expanded.changes.some(
        (change) => change instanceof AlterTableDropConstraint,
      ),
    ).toBe(true);
    expect(
      expanded.changes.some(
        (change) => change instanceof AlterTableAddConstraint,
      ),
    ).toBe(true);
    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      false,
    );
    expect(
      expanded.changes.some((change) => change instanceof CreateTable),
    ).toBe(false);
  });

  test("preserves NOT VALID table check state when synthesizing a replacement", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const mainTable = tableWithCheckConstraint(
      "public.normalize_value(value) > 0",
      { validated: false },
    );
    const branchTable = tableWithCheckConstraint(
      "public.normalize_value(value) > 0",
      { validated: false },
    );

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      tables: { [mainTable.stableId]: mainTable },
      depends: [
        {
          dependent_stable_id: "constraint:public.items.items_value_check",
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      tables: { [branchTable.stableId]: branchTable },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });
    const addConstraint = expanded.changes.find(
      (change) => change instanceof AlterTableAddConstraint,
    );

    expect(addConstraint).toBeInstanceOf(AlterTableAddConstraint);
    expect(addConstraint?.serialize()).toContain("NOT VALID");
    expect(
      expanded.changes.some(
        (change) => change instanceof AlterTableValidateConstraint,
      ),
    ).toBe(false);
  });

  test("adds a missing release when a table check restore is already covered", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const mainTable = tableWithCheckConstraint(
      "public.normalize_value(value) > 0",
    );
    const branchTable = tableWithCheckConstraint(
      "public.normalize_value(value) > 0",
    );
    const addConstraint = new AlterTableAddConstraint({
      table: branchTable,
      constraint: branchTable.constraints[0] as NonNullable<
        (typeof branchTable.constraints)[number]
      >,
    });

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
      addConstraint,
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      tables: { [mainTable.stableId]: mainTable },
      depends: [
        {
          dependent_stable_id: "constraint:public.items.items_value_check",
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      tables: { [branchTable.stableId]: branchTable },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(expanded.changes).toContain(addConstraint);
    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterTableDropConstraint,
      ),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterTableAddConstraint,
      ),
    ).toHaveLength(1);
    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      false,
    );
  });

  test("does not replace a table when a replaced procedure only drops a dependent table check constraint", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const mainTable = tableWithCheckConstraint(
      "public.normalize_value(value) > 0",
    );
    const branchTable = tableWithDefault(null);
    const dropConstraint = new AlterTableDropConstraint({
      table: mainTable,
      constraint: mainTable.constraints[0] as NonNullable<
        (typeof mainTable.constraints)[number]
      >,
    });

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
      dropConstraint,
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      tables: { [mainTable.stableId]: mainTable },
      depends: [
        {
          dependent_stable_id: "constraint:public.items.items_value_check",
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      tables: { [branchTable.stableId]: branchTable },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(expanded.changes).toContain(dropConstraint);
    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterTableDropConstraint,
      ),
    ).toHaveLength(1);
    expect(
      expanded.changes.some(
        (change) => change instanceof AlterTableAddConstraint,
      ),
    ).toBe(false);
    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      false,
    );
    expect(
      expanded.changes.some((change) => change instanceof CreateTable),
    ).toBe(false);
    expect(expanded.replacedTableIds.has(mainTable.stableId)).toBe(false);
  });

  test("skips partition-cloned table check constraints during expression replacement", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const cloneConstraint = {
      is_partition_clone: true,
      parent_constraint_schema: "public",
      parent_constraint_name: "items_value_check",
      parent_table_schema: "public",
      parent_table_name: "items",
    };
    const mainTable = new Table({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...tableWithCheckConstraint("public.normalize_value(value) > 0", {
        ...cloneConstraint,
      }),
      name: "items_2026",
      is_partition: true,
      partition_bound: "FOR VALUES FROM (2026) TO (2027)",
      parent_schema: "public",
      parent_name: "items",
    });
    const branchTable = new Table({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...tableWithCheckConstraint("public.normalize_value(value) > 0", {
        ...cloneConstraint,
      }),
      name: "items_2026",
      is_partition: true,
      partition_bound: "FOR VALUES FROM (2026) TO (2027)",
      parent_schema: "public",
      parent_name: "items",
    });
    const constraintId = "constraint:public.items_2026.items_value_check";

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      tables: { [mainTable.stableId]: mainTable },
      depends: [
        {
          dependent_stable_id: constraintId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      tables: { [branchTable.stableId]: branchTable },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterTableDropConstraint,
      ),
    ).toHaveLength(0);
    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterTableAddConstraint,
      ),
    ).toHaveLength(0);
    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      false,
    );
    expect(
      expanded.changes.some((change) => change instanceof CreateTable),
    ).toBe(false);
  });

  test("synthesizes one table check constraint replacement when the expression depends on two replaced procedures", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainNormalize = procedureWithArgs(["integer"], "normalize_value");
    const branchNormalize = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainNormalize,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const mainShift = procedureWithArgs(["integer"], "shift_value");
    const branchShift = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainShift,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.shift_value(renamed integer) RETURNS integer",
    });
    const mainTable = tableWithCheckConstraint(
      "public.normalize_value(value) > public.shift_value(value)",
    );
    const branchTable = tableWithCheckConstraint(
      "public.normalize_value(value) > public.shift_value(value)",
    );

    const changes: Change[] = [
      new DropProcedure({ procedure: mainNormalize }),
      new CreateProcedure({ procedure: branchNormalize }),
      new DropProcedure({ procedure: mainShift }),
      new CreateProcedure({ procedure: branchShift }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: {
        [mainNormalize.stableId]: mainNormalize,
        [mainShift.stableId]: mainShift,
      },
      tables: { [mainTable.stableId]: mainTable },
      depends: [
        {
          dependent_stable_id: "constraint:public.items.items_value_check",
          referenced_stable_id: mainNormalize.stableId,
          deptype: "n",
        },
        {
          dependent_stable_id: "constraint:public.items.items_value_check",
          referenced_stable_id: mainShift.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: {
        [branchNormalize.stableId]: branchNormalize,
        [branchShift.stableId]: branchShift,
      },
      tables: { [branchTable.stableId]: branchTable },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterTableDropConstraint,
      ),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterTableAddConstraint,
      ),
    ).toHaveLength(1);
  });

  test("synthesizes a domain check constraint replacement for an unchanged expression that depends on a replaced procedure", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const mainDomain = domainWithConstraint(
      "public.normalize_value(VALUE) > 0",
    );
    const branchDomain = domainWithConstraint(
      "public.normalize_value(VALUE) > 0",
    );
    const tableUsingDomain = tableWithDefault(null, {
      data_type: "item_value",
      data_type_str: "public.item_value",
      is_custom_type: true,
      custom_type_type: "d",
      custom_type_category: "N",
      custom_type_schema: "public",
      custom_type_name: "item_value",
    });

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      domains: { [mainDomain.stableId]: mainDomain },
      tables: { [tableUsingDomain.stableId]: tableUsingDomain },
      depends: [
        {
          dependent_stable_id: "constraint:public.item_value.item_value_check",
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
        {
          dependent_stable_id: "column:public.items.value",
          referenced_stable_id: mainDomain.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      domains: { [branchDomain.stableId]: branchDomain },
      tables: { [tableUsingDomain.stableId]: tableUsingDomain },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(
      expanded.changes.some(
        (change) => change instanceof AlterDomainDropConstraint,
      ),
    ).toBe(true);
    expect(
      expanded.changes.some(
        (change) => change instanceof AlterDomainAddConstraint,
      ),
    ).toBe(true);
    expect(
      expanded.changes.some((change) => change instanceof DropDomain),
    ).toBe(false);
    expect(
      expanded.changes.some((change) => change instanceof CreateDomain),
    ).toBe(false);
    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      false,
    );
    expect(
      expanded.changes.some((change) => change instanceof CreateTable),
    ).toBe(false);
  });

  test("does not duplicate a covered domain check constraint release", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const mainDomain = domainWithConstraint(
      "public.normalize_value(VALUE) > 0",
    );
    const branchDomain = domainWithConstraint(
      "public.normalize_value(VALUE) > 0",
    );
    const tableUsingDomain = tableWithDefault(null, {
      data_type: "item_value",
      data_type_str: "public.item_value",
      is_custom_type: true,
      custom_type_type: "d",
      custom_type_category: "N",
      custom_type_schema: "public",
      custom_type_name: "item_value",
    });
    const dropConstraint = new AlterDomainDropConstraint({
      domain: mainDomain,
      constraint: mainDomain.constraints[0] as Domain["constraints"][number],
    });
    const addConstraint = new AlterDomainAddConstraint({
      domain: branchDomain,
      constraint: branchDomain.constraints[0] as Domain["constraints"][number],
    });

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
      dropConstraint,
      addConstraint,
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      domains: { [mainDomain.stableId]: mainDomain },
      tables: { [tableUsingDomain.stableId]: tableUsingDomain },
      depends: [
        {
          dependent_stable_id: "constraint:public.item_value.item_value_check",
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
        {
          dependent_stable_id: "column:public.items.value",
          referenced_stable_id: mainDomain.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      domains: { [branchDomain.stableId]: branchDomain },
      tables: { [tableUsingDomain.stableId]: tableUsingDomain },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(expanded.changes).toContain(dropConstraint);
    expect(expanded.changes).toContain(addConstraint);
    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterDomainDropConstraint,
      ),
    ).toHaveLength(1);
    expect(
      expanded.changes.filter(
        (change) => change instanceof AlterDomainAddConstraint,
      ),
    ).toHaveLength(1);
    expect(
      expanded.changes.some((change) => change instanceof DropDomain),
    ).toBe(false);
  });

  test("preserves NOT VALID domain check state when synthesizing a replacement", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
      definition:
        "CREATE FUNCTION public.normalize_value(renamed integer) RETURNS integer",
    });
    const mainDomain = domainWithConstraint(
      "public.normalize_value(VALUE) > 0",
      { validated: false },
    );
    const branchDomain = domainWithConstraint(
      "public.normalize_value(VALUE) > 0",
      { validated: false },
    );
    const tableUsingDomain = tableWithDefault(null, {
      data_type: "item_value",
      data_type_str: "public.item_value",
      is_custom_type: true,
      custom_type_type: "d",
      custom_type_category: "N",
      custom_type_schema: "public",
      custom_type_name: "item_value",
    });

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      domains: { [mainDomain.stableId]: mainDomain },
      tables: { [tableUsingDomain.stableId]: tableUsingDomain },
      depends: [
        {
          dependent_stable_id: "constraint:public.item_value.item_value_check",
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
        {
          dependent_stable_id: "column:public.items.value",
          referenced_stable_id: mainDomain.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      domains: { [branchDomain.stableId]: branchDomain },
      tables: { [tableUsingDomain.stableId]: tableUsingDomain },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });
    const addConstraint = expanded.changes.find(
      (change) => change instanceof AlterDomainAddConstraint,
    );

    expect(addConstraint).toBeInstanceOf(AlterDomainAddConstraint);
    expect(addConstraint?.serialize()).toContain("NOT VALID");
    expect(
      expanded.changes.some(
        (change) => change instanceof AlterDomainValidateConstraint,
      ),
    ).toBe(false);
  });

  test("does not replace a domain or table when a procedure signature replacement is covered by a domain default alter", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = procedureWithArgs(["bigint"]);
    const mainDomain = domainWithDefault("public.normalize_value(1)");
    const branchDomain = domainWithDefault(
      "public.normalize_value((1)::bigint)",
    );
    const tableUsingDomain = tableWithDefault(null, {
      data_type: "item_value",
      data_type_str: "public.item_value",
      is_custom_type: true,
      custom_type_type: "d",
      custom_type_category: "N",
      custom_type_schema: "public",
      custom_type_name: "item_value",
    });
    const setDomainDefault = new AlterDomainSetDefault({
      domain: mainDomain,
      defaultValue: branchDomain.default_value ?? "NULL",
    });

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
      setDomainDefault,
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      domains: { [mainDomain.stableId]: mainDomain },
      tables: { [tableUsingDomain.stableId]: tableUsingDomain },
      depends: [
        {
          dependent_stable_id: mainDomain.stableId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
        {
          dependent_stable_id: "column:public.items.value",
          referenced_stable_id: mainDomain.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      domains: { [branchDomain.stableId]: branchDomain },
      tables: { [tableUsingDomain.stableId]: tableUsingDomain },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(expanded.changes).toContain(setDomainDefault);
    expect(
      expanded.changes.some(
        (change) => change instanceof AlterDomainDropDefault,
      ),
    ).toBe(true);
    expect(
      expanded.changes.some((change) => change instanceof DropDomain),
    ).toBe(false);
    expect(
      expanded.changes.some((change) => change instanceof CreateDomain),
    ).toBe(false);
    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      false,
    );
    expect(
      expanded.changes.some((change) => change instanceof CreateTable),
    ).toBe(false);
    expect(expanded.replacedTableIds.has(tableUsingDomain.stableId)).toBe(
      false,
    );
  });

  test("does not replace a domain or table when a procedure signature replacement is covered by dropping a domain default", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainProcedure = procedureWithArgs(["integer"]);
    const branchProcedure = procedureWithArgs(["bigint"]);
    const mainDomain = domainWithDefault("public.normalize_value(1)");
    const branchDomain = domainWithDefault(null);
    const tableUsingDomain = tableWithDefault(null, {
      data_type: "item_value",
      data_type_str: "public.item_value",
      is_custom_type: true,
      custom_type_type: "d",
      custom_type_category: "N",
      custom_type_schema: "public",
      custom_type_name: "item_value",
    });
    const dropDomainDefault = new AlterDomainDropDefault({
      domain: mainDomain,
    });

    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
      dropDomainDefault,
    ];
    const mainCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [mainProcedure.stableId]: mainProcedure },
      domains: { [mainDomain.stableId]: mainDomain },
      tables: { [tableUsingDomain.stableId]: tableUsingDomain },
      depends: [
        {
          dependent_stable_id: mainDomain.stableId,
          referenced_stable_id: mainProcedure.stableId,
          deptype: "n",
        },
        {
          dependent_stable_id: "column:public.items.value",
          referenced_stable_id: mainDomain.stableId,
          deptype: "n",
        },
      ],
    });
    const branchCatalog = new Catalog({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...baseline,
      procedures: { [branchProcedure.stableId]: branchProcedure },
      domains: { [branchDomain.stableId]: branchDomain },
      tables: { [tableUsingDomain.stableId]: tableUsingDomain },
      depends: [],
    });

    const expanded = expandReplaceDependencies({
      changes,
      mainCatalog,
      branchCatalog,
    });

    expect(expanded.changes).toContain(dropDomainDefault);
    expect(
      expanded.changes.some((change) => change instanceof DropDomain),
    ).toBe(false);
    expect(
      expanded.changes.some((change) => change instanceof CreateDomain),
    ).toBe(false);
    expect(expanded.changes.some((change) => change instanceof DropTable)).toBe(
      false,
    );
    expect(
      expanded.changes.some((change) => change instanceof CreateTable),
    ).toBe(false);
    expect(expanded.replacedTableIds.has(tableUsingDomain.stableId)).toBe(
      false,
    );
  });
});
