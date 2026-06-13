import { describe, expect, test } from "bun:test";
import { Catalog, createEmptyCatalog } from "../catalog.model.ts";
import type { Change } from "../change.types.ts";
import type { PgDepend } from "../depend.ts";
import {
  AlterDomainAddConstraint,
  AlterDomainDropConstraint,
  AlterDomainDropDefault,
} from "../objects/domain/changes/domain.alter.ts";
import { DropDomain } from "../objects/domain/changes/domain.drop.ts";
import { Domain } from "../objects/domain/domain.model.ts";
import { CreateIndex } from "../objects/index/changes/index.create.ts";
import { Index } from "../objects/index/index.model.ts";
import { CreateMaterializedView } from "../objects/materialized-view/changes/materialized-view.create.ts";
import { MaterializedView } from "../objects/materialized-view/materialized-view.model.ts";
import { CreateProcedure } from "../objects/procedure/changes/procedure.create.ts";
import { DropProcedure } from "../objects/procedure/changes/procedure.drop.ts";
import { Procedure } from "../objects/procedure/procedure.model.ts";
import {
  AlterPublicationAddTables,
  AlterPublicationDropTables,
  AlterPublicationSetOwner,
} from "../objects/publication/changes/publication.alter.ts";
import { Publication } from "../objects/publication/publication.model.ts";
import { SetRuleEnabledState } from "../objects/rule/changes/rule.alter.ts";
import { CreateCommentOnRule } from "../objects/rule/changes/rule.comment.ts";
import { CreateRule } from "../objects/rule/changes/rule.create.ts";
import { Rule } from "../objects/rule/rule.model.ts";
import { AlterSequenceChangeOwner } from "../objects/sequence/changes/sequence.alter.ts";
import { CreateSequence } from "../objects/sequence/changes/sequence.create.ts";
import { GrantSequencePrivileges } from "../objects/sequence/changes/sequence.privilege.ts";
import { Sequence } from "../objects/sequence/sequence.model.ts";
import {
  AlterTableAddConstraint,
  AlterTableAlterColumnDropDefault,
  AlterTableAlterColumnSetDefault,
  AlterTableAlterColumnType,
  AlterTableChangeOwner,
  AlterTableDropConstraint,
} from "../objects/table/changes/table.alter.ts";
import { DropTable } from "../objects/table/changes/table.drop.ts";
import { Table } from "../objects/table/table.model.ts";
import { SetTriggerEnabledState } from "../objects/trigger/changes/trigger.alter.ts";
import { CreateCommentOnTrigger } from "../objects/trigger/changes/trigger.comment.ts";
import { CreateTrigger } from "../objects/trigger/changes/trigger.create.ts";
import { Trigger } from "../objects/trigger/trigger.model.ts";
import { AlterViewChangeOwner } from "../objects/view/changes/view.alter.ts";
import { CreateCommentOnView } from "../objects/view/changes/view.comment.ts";
import { CreateView } from "../objects/view/changes/view.create.ts";
import { DropView } from "../objects/view/changes/view.drop.ts";
import { GrantViewPrivileges } from "../objects/view/changes/view.privilege.ts";
import { View } from "../objects/view/view.model.ts";
import { sortChanges } from "./sort-changes.ts";

const baseTableProps = {
  schema: "public",
  persistence: "p" as const,
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
  partition_by: null,
  owner: "postgres",
  comment: null,
  parent_schema: null,
  parent_name: null,
  privileges: [],
};

function integerColumn(name: string, position: number) {
  return {
    name,
    position,
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
  };
}

function fkConstraint(props: {
  name: string;
  fkColumn: string;
  targetTable: string;
  targetColumn?: string;
}) {
  const targetColumn = props.targetColumn ?? "id";
  return {
    name: props.name,
    constraint_type: "f" as const,
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
    key_columns: [props.fkColumn],
    foreign_key_columns: [targetColumn],
    foreign_key_table: props.targetTable,
    foreign_key_schema: "public",
    foreign_key_table_is_partition: false,
    foreign_key_parent_schema: null,
    foreign_key_parent_table: null,
    foreign_key_effective_schema: "public",
    foreign_key_effective_table: props.targetTable,
    on_update: "a" as const,
    on_delete: "a" as const,
    match_type: "s" as const,
    check_expression: null,
    owner: "postgres",
    definition: `FOREIGN KEY (${props.fkColumn}) REFERENCES public.${props.targetTable}(${targetColumn})`,
    comment: null,
  };
}

function uniqueConstraint(name: string, column: string) {
  return {
    name,
    constraint_type: "u" as const,
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
    key_columns: [column],
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
    definition: `UNIQUE (${column})`,
    comment: null,
  };
}

function checkConstraint(name: string, expression: string) {
  return {
    name,
    constraint_type: "c" as const,
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
    check_expression: expression,
    owner: "postgres",
    definition: `CHECK (${expression})`,
    comment: null,
  };
}

function table(
  name: string,
  constraints: ConstructorParameters<typeof Table>[0]["constraints"] = [],
) {
  return new Table({
    ...baseTableProps,
    name,
    columns: [
      { ...integerColumn("id", 1), not_null: true },
      integerColumn("post_id", 2),
      integerColumn("lab_id", 3),
    ],
    constraints,
  });
}

function view(name: string, columns = [integerColumn("id", 1)]) {
  return new View({
    schema: "public",
    name,
    definition: "SELECT id FROM users",
    row_security: false,
    force_row_security: false,
    has_indexes: false,
    has_rules: true,
    has_triggers: false,
    has_subclasses: false,
    is_populated: true,
    replica_identity: "d",
    is_partition: false,
    options: null,
    partition_bound: null,
    owner: "postgres",
    comment: null,
    columns,
    privileges: [],
  });
}

function materializedView(name: string) {
  return new MaterializedView({
    schema: "public",
    name,
    definition: "SELECT id FROM public.users",
    row_security: false,
    force_row_security: false,
    has_indexes: true,
    has_rules: false,
    has_triggers: false,
    has_subclasses: false,
    is_populated: true,
    replica_identity: "d",
    is_partition: false,
    options: null,
    partition_bound: null,
    owner: "postgres",
    comment: null,
    columns: [integerColumn("id", 1)],
    privileges: [],
  });
}

function indexOnMaterializedView(viewName: string, indexName: string) {
  return new Index({
    schema: "public",
    table_name: viewName,
    name: indexName,
    storage_params: [],
    statistics_target: [0],
    index_type: "btree",
    tablespace: null,
    is_unique: false,
    is_primary: false,
    is_exclusion: false,
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
    is_owned_by_constraint: false,
    table_relkind: "m",
    is_partitioned_index: false,
    is_index_partition: false,
    parent_index_name: null,
    definition: `CREATE INDEX ${indexName} ON public.${viewName} (id)`,
    comment: null,
    owner: "postgres",
  });
}

function sequenceOwnedBy(tableName: string, columnName: string) {
  return new Sequence({
    schema: "public",
    name: `${tableName}_${columnName}_seq`,
    data_type: "bigint",
    start_value: 1,
    minimum_value: BigInt(1),
    maximum_value: BigInt("9223372036854775807"),
    increment: 1,
    cycle_option: false,
    cache_size: 1,
    persistence: "p",
    owned_by_schema: "public",
    owned_by_table: tableName,
    owned_by_column: columnName,
    comment: null,
    privileges: [],
    owner: "old_owner",
    security_labels: [],
  });
}

function triggerOnTable(
  tableName: string,
  overrides: Partial<ConstructorParameters<typeof Trigger>[0]> = {},
) {
  return new Trigger({
    schema: "public",
    name: `${tableName}_audit_trigger`,
    table_name: tableName,
    table_relkind: "r",
    function_schema: "public",
    function_name: "audit_row",
    trigger_type: 16,
    enabled: "O",
    is_internal: false,
    deferrable: false,
    initially_deferred: false,
    argument_count: 0,
    column_numbers: [],
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
    definition: `CREATE TRIGGER ${tableName}_audit_trigger AFTER UPDATE ON public.${tableName} FOR EACH ROW EXECUTE FUNCTION public.audit_row()`,
    comment: "retained trigger comment",
    ...overrides,
  });
}

function ruleOnView(viewName: string) {
  return new Rule({
    schema: "public",
    name: `${viewName}_update_rule`,
    table_name: viewName,
    relation_kind: "v",
    event: "UPDATE",
    enabled: "R",
    is_instead: true,
    owner: "postgres",
    definition: `CREATE RULE ${viewName}_update_rule AS ON UPDATE TO public.${viewName} DO INSTEAD NOTHING`,
    comment: "retained rule comment",
    columns: [],
  });
}

function domain(defaultValue: string | null, name = "score") {
  return new Domain({
    schema: "public",
    name,
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

function domainWithConstraint(name: string, expression: string) {
  return new Domain({
    schema: "public",
    name: "score",
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
        name,
        validated: true,
        is_local: true,
        no_inherit: false,
        check_expression: expression,
      },
    ],
    privileges: [],
  });
}

function procedure(argumentTypes: string[]) {
  return new Procedure({
    schema: "public",
    name: "normalize_value",
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

async function catalogWithDepends(depends: PgDepend[]) {
  const base = await createEmptyCatalog(170000, "postgres");
  // oxlint-disable-next-line typescript/no-misused-spread
  return new Catalog({ ...base, depends });
}

function changeLabel(change: Change) {
  if (change instanceof AlterDomainDropConstraint) {
    return `${change.constructor.name}:${change.domain.name}.${change.constraint.name}`;
  }
  if (change instanceof AlterDomainAddConstraint) {
    return `${change.constructor.name}:${change.domain.name}.${change.constraint.name}`;
  }
  if (change instanceof DropDomain) {
    return `${change.constructor.name}:${change.domain.name}`;
  }
  if (change instanceof AlterTableDropConstraint) {
    return `${change.constructor.name}:${change.table.name}.${change.constraint.name}`;
  }
  if (change instanceof AlterTableAddConstraint) {
    return `${change.constructor.name}:${change.table.name}.${change.constraint.name}`;
  }
  if (change instanceof DropTable) {
    return `${change.constructor.name}:${change.table.name}`;
  }
  if (change instanceof DropProcedure || change instanceof CreateProcedure) {
    return `${change.constructor.name}:${change.procedure.stableId}`;
  }
  return change.constructor.name;
}

describe("sortChanges", () => {
  test("orders owned sequence owner after owning table owner", async () => {
    const owningTable = new Table({
      ...baseTableProps,
      name: "items",
      columns: [{ ...integerColumn("id", 1), not_null: true }],
      constraints: [],
      owner: "old_owner",
    });
    const ownedSequence = sequenceOwnedBy("items", "id");
    const changes: Change[] = [
      new AlterSequenceChangeOwner({
        sequence: ownedSequence,
        owner: "app_owner",
      }),
      new AlterTableChangeOwner({ table: owningTable, owner: "app_owner" }),
    ];
    const mainCatalog = await catalogWithDepends([]);
    const branchCatalog = await catalogWithDepends([]);

    const sorted = sortChanges({ mainCatalog, branchCatalog }, changes);
    const tableOwnerIndex = sorted.findIndex(
      (change) => change instanceof AlterTableChangeOwner,
    );
    const sequenceOwnerIndex = sorted.findIndex(
      (change) => change instanceof AlterSequenceChangeOwner,
    );

    expect(tableOwnerIndex).toBeGreaterThan(-1);
    expect(sequenceOwnerIndex).toBeGreaterThan(tableOwnerIndex);
  });

  test("orders sequence privilege replay before owner restore", async () => {
    const sequence = new Sequence({
      schema: "public",
      name: "items_id_seq",
      data_type: "bigint",
      start_value: 1,
      minimum_value: BigInt(1),
      maximum_value: BigInt("9223372036854775807"),
      increment: 1,
      cycle_option: false,
      cache_size: 1,
      persistence: "p",
      owned_by_schema: null,
      owned_by_table: null,
      owned_by_column: null,
      comment: null,
      privileges: [],
      owner: "app_owner",
      security_labels: [],
    });
    const changes: Change[] = [
      new CreateSequence({ sequence }),
      new AlterSequenceChangeOwner({ sequence, owner: "app_owner" }),
      new GrantSequencePrivileges({
        sequence,
        grantee: "app_reader",
        privileges: [{ privilege: "USAGE", grantable: false }],
        version: 170000,
      }),
    ];
    const mainCatalog = await catalogWithDepends([]);
    const branchCatalog = await catalogWithDepends([]);

    const sorted = sortChanges({ mainCatalog, branchCatalog }, changes);
    const grantIndex = sorted.findIndex(
      (change) => change instanceof GrantSequencePrivileges,
    );
    const ownerIndex = sorted.findIndex(
      (change) => change instanceof AlterSequenceChangeOwner,
    );

    expect(grantIndex).toBeGreaterThan(-1);
    expect(ownerIndex).toBeGreaterThan(grantIndex);
  });

  test("orders trigger comment replay before table owner restore", async () => {
    const owningTable = table("items");
    const trigger = triggerOnTable("items");
    const changes: Change[] = [
      new AlterTableChangeOwner({ table: owningTable, owner: "app_owner" }),
      new CreateCommentOnTrigger({ trigger }),
    ];
    const mainCatalog = await catalogWithDepends([]);
    const branchCatalog = await catalogWithDepends([]);

    const sorted = sortChanges({ mainCatalog, branchCatalog }, changes);
    const commentIndex = sorted.findIndex(
      (change) => change instanceof CreateCommentOnTrigger,
    );
    const ownerIndex = sorted.findIndex(
      (change) => change instanceof AlterTableChangeOwner,
    );

    expect(commentIndex).toBeGreaterThan(-1);
    expect(ownerIndex).toBeGreaterThan(commentIndex);
  });

  test("orders view metadata replay before view owner restore", async () => {
    const retainedView = new View({
      schema: "public",
      name: "active_users",
      definition: "SELECT id FROM users",
      row_security: false,
      force_row_security: false,
      has_indexes: false,
      has_rules: true,
      has_triggers: false,
      has_subclasses: false,
      is_populated: true,
      replica_identity: "d",
      is_partition: false,
      options: null,
      partition_bound: null,
      owner: "app_owner",
      comment: "retained view comment",
      columns: [integerColumn("id", 1)],
      privileges: [
        {
          grantee: "app_reader",
          privilege: "SELECT",
          grantable: false,
        },
      ],
    });
    const changes: Change[] = [
      new CreateView({ view: retainedView }),
      new AlterViewChangeOwner({ view: retainedView, owner: "app_owner" }),
      new CreateCommentOnView({ view: retainedView }),
      new GrantViewPrivileges({
        view: retainedView,
        grantee: "app_reader",
        privileges: [{ privilege: "SELECT", grantable: false }],
        version: 170000,
      }),
    ];
    const mainCatalog = await catalogWithDepends([]);
    const branchCatalog = await catalogWithDepends([]);

    const sorted = sortChanges({ mainCatalog, branchCatalog }, changes);
    const commentIndex = sorted.findIndex(
      (change) => change instanceof CreateCommentOnView,
    );
    const grantIndex = sorted.findIndex(
      (change) => change instanceof GrantViewPrivileges,
    );
    const ownerIndex = sorted.findIndex(
      (change) => change instanceof AlterViewChangeOwner,
    );

    expect(commentIndex).toBeGreaterThan(-1);
    expect(grantIndex).toBeGreaterThan(-1);
    expect(ownerIndex).toBeGreaterThan(commentIndex);
    expect(ownerIndex).toBeGreaterThan(grantIndex);
  });

  test("orders view trigger replay before view owner restore", async () => {
    const retainedView = new View({
      schema: "public",
      name: "active_users",
      definition: "SELECT id FROM users",
      row_security: false,
      force_row_security: false,
      has_indexes: false,
      has_rules: false,
      has_triggers: true,
      has_subclasses: false,
      is_populated: true,
      replica_identity: "d",
      is_partition: false,
      options: null,
      partition_bound: null,
      owner: "app_owner",
      comment: null,
      columns: [integerColumn("id", 1)],
      privileges: [],
    });
    const trigger = triggerOnTable("active_users", {
      table_relkind: "v",
      definition:
        "CREATE TRIGGER active_users_audit_trigger INSTEAD OF UPDATE ON public.active_users FOR EACH ROW EXECUTE FUNCTION public.audit_row()",
      enabled: "R",
    });
    const changes: Change[] = [
      new AlterViewChangeOwner({ view: retainedView, owner: "app_owner" }),
      new CreateTrigger({ trigger }),
      new SetTriggerEnabledState({ trigger }),
      new CreateCommentOnTrigger({ trigger }),
    ];
    const mainCatalog = await catalogWithDepends([]);
    const branchCatalog = await catalogWithDepends([]);

    const sorted = sortChanges({ mainCatalog, branchCatalog }, changes);
    const createTriggerIndex = sorted.findIndex(
      (change) => change instanceof CreateTrigger,
    );
    const enabledStateIndex = sorted.findIndex(
      (change) => change instanceof SetTriggerEnabledState,
    );
    const commentIndex = sorted.findIndex(
      (change) => change instanceof CreateCommentOnTrigger,
    );
    const ownerIndex = sorted.findIndex(
      (change) => change instanceof AlterViewChangeOwner,
    );

    expect(createTriggerIndex).toBeGreaterThan(-1);
    expect(enabledStateIndex).toBeGreaterThan(-1);
    expect(commentIndex).toBeGreaterThan(-1);
    expect(ownerIndex).toBeGreaterThan(createTriggerIndex);
    expect(ownerIndex).toBeGreaterThan(enabledStateIndex);
    expect(ownerIndex).toBeGreaterThan(commentIndex);
  });

  test("orders view rule metadata replay before view owner restore", async () => {
    const retainedView = new View({
      schema: "public",
      name: "active_users",
      definition: "SELECT id FROM users",
      row_security: false,
      force_row_security: false,
      has_indexes: false,
      has_rules: true,
      has_triggers: false,
      has_subclasses: false,
      is_populated: true,
      replica_identity: "d",
      is_partition: false,
      options: null,
      partition_bound: null,
      owner: "app_owner",
      comment: null,
      columns: [integerColumn("id", 1)],
      privileges: [],
    });
    const rule = ruleOnView("active_users");
    const changes: Change[] = [
      new CreateRule({ rule }),
      new AlterViewChangeOwner({ view: retainedView, owner: "app_owner" }),
      new CreateCommentOnRule({ rule }),
      new SetRuleEnabledState({ rule }),
    ];
    const mainCatalog = await catalogWithDepends([]);
    const branchCatalog = await catalogWithDepends([]);

    const sorted = sortChanges({ mainCatalog, branchCatalog }, changes);
    const commentIndex = sorted.findIndex(
      (change) => change instanceof CreateCommentOnRule,
    );
    const enabledStateIndex = sorted.findIndex(
      (change) => change instanceof SetRuleEnabledState,
    );
    const ownerIndex = sorted.findIndex(
      (change) => change instanceof AlterViewChangeOwner,
    );

    expect(commentIndex).toBeGreaterThan(-1);
    expect(enabledStateIndex).toBeGreaterThan(-1);
    expect(ownerIndex).toBeGreaterThan(commentIndex);
    expect(ownerIndex).toBeGreaterThan(enabledStateIndex);
  });

  test("orders publication table replay before publication owner restore", async () => {
    const publication = new Publication({
      name: "items_pub",
      owner: "app_owner",
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
          row_filter: "(value > 0)",
        },
      ],
      schemas: [],
    });
    const changes: Change[] = [
      new AlterPublicationSetOwner({
        publication,
        owner: "app_owner",
      }),
      new AlterPublicationAddTables({
        publication,
        tables: publication.tables,
      }),
    ];
    const mainCatalog = await catalogWithDepends([]);
    const branchCatalog = await catalogWithDepends([]);

    const sorted = sortChanges({ mainCatalog, branchCatalog }, changes);
    const addTablesIndex = sorted.findIndex(
      (change) => change instanceof AlterPublicationAddTables,
    );
    const ownerIndex = sorted.findIndex(
      (change) => change instanceof AlterPublicationSetOwner,
    );

    expect(addTablesIndex).toBeGreaterThan(-1);
    expect(ownerIndex).toBeGreaterThan(addTablesIndex);
  });

  test("orders materialized view indexes after recreated materialized views", async () => {
    const branchMaterializedView = materializedView("user_ids_mv");
    const branchIndex = indexOnMaterializedView(
      "user_ids_mv",
      "user_ids_mv_id_idx",
    );
    const changes: Change[] = [
      new CreateIndex({
        index: branchIndex,
        indexableObject: branchMaterializedView,
      }),
      new CreateMaterializedView({ materializedView: branchMaterializedView }),
    ];
    const mainCatalog = await catalogWithDepends([]);
    const branchCatalog = await catalogWithDepends([]);

    const sorted = sortChanges({ mainCatalog, branchCatalog }, changes);

    expect(sorted.map(changeLabel)).toEqual([
      "CreateMaterializedView",
      "CreateIndex",
    ]);
  });

  test("orders dependent view drop before drop-phase column type rewrite", async () => {
    const branchTable = table("users");
    const mainColumn = {
      ...integerColumn("age", 4),
      data_type: "numeric",
      data_type_str: "numeric",
    };
    const branchColumn = integerColumn("age", 4);
    const dependentView = view("user_ages", [
      integerColumn("id", 1),
      mainColumn,
    ]);
    const recreatedView = view("user_ages", [
      integerColumn("id", 1),
      branchColumn,
    ]);
    const changes: Change[] = [
      new AlterTableAlterColumnType({
        table: branchTable,
        column: branchColumn,
        previousColumn: mainColumn,
      }),
      new DropView({ view: dependentView }),
      new CreateView({ view: recreatedView }),
    ];
    const mainCatalog = await catalogWithDepends([
      {
        dependent_stable_id: dependentView.stableId,
        referenced_stable_id: "column:public.users.age",
        deptype: "n",
      },
    ]);
    const branchCatalog = await catalogWithDepends([]);

    const sorted = sortChanges({ mainCatalog, branchCatalog }, changes);

    expect(sorted.map(changeLabel)).toEqual([
      "DropView",
      "AlterTableAlterColumnType",
      "CreateView",
    ]);
  });

  test("breaks publication FK-chain constraint-drop cycle with one dropped table", async () => {
    const labs = table("labs", [uniqueConstraint("unique_lab_id", "id")]);
    const posts = table("posts", [
      fkConstraint({
        name: "posts_lab_id_fkey",
        fkColumn: "lab_id",
        targetTable: "labs",
      }),
    ]);
    const publication = new Publication({
      name: "supabase_realtime",
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
          name: "labs",
          columns: null,
          row_filter: null,
        },
        {
          schema: "public",
          name: "posts",
          columns: null,
          row_filter: null,
        },
      ],
      schemas: [],
    });
    const changes: Change[] = [
      new AlterPublicationDropTables({
        publication,
        tables: publication.tables,
      }),
      new DropTable({ table: posts }),
      new AlterTableDropConstraint({
        table: labs,
        constraint: labs.constraints[0],
      }),
    ];
    const mainCatalog = await catalogWithDepends([
      {
        dependent_stable_id: "publication:supabase_realtime",
        referenced_stable_id: "table:public.posts",
        deptype: "n",
      },
      {
        dependent_stable_id: "constraint:public.posts.posts_lab_id_fkey",
        referenced_stable_id: "constraint:public.labs.unique_lab_id",
        deptype: "n",
      },
    ]);
    const branchCatalog = await catalogWithDepends([]);

    const sorted = sortChanges({ mainCatalog, branchCatalog }, changes);

    expect(sorted.map(changeLabel)).toContain(
      "AlterTableDropConstraint:posts.posts_lab_id_fkey",
    );
  });

  test("breaks publication FK-chain constraint-drop cycle in the drop phase", async () => {
    const labs = table("labs", [uniqueConstraint("unique_lab_id", "id")]);
    const posts = table("posts", [
      fkConstraint({
        name: "posts_lab_id_fkey",
        fkColumn: "lab_id",
        targetTable: "labs",
      }),
    ]);
    const postAttachments = table("post_attachments", [
      fkConstraint({
        name: "post_attachments_post_id_fkey",
        fkColumn: "post_id",
        targetTable: "posts",
      }),
    ]);
    const publication = new Publication({
      name: "supabase_realtime",
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
          name: "labs",
          columns: null,
          row_filter: null,
        },
        {
          schema: "public",
          name: "post_attachments",
          columns: null,
          row_filter: null,
        },
        {
          schema: "public",
          name: "posts",
          columns: null,
          row_filter: null,
        },
      ],
      schemas: [],
    });
    const changes: Change[] = [
      new AlterPublicationDropTables({
        publication,
        tables: publication.tables,
      }),
      new DropTable({ table: postAttachments }),
      new DropTable({ table: posts }),
      new AlterTableDropConstraint({
        table: labs,
        constraint: labs.constraints[0],
      }),
    ];
    const mainCatalog = await catalogWithDepends([
      {
        dependent_stable_id: "publication:supabase_realtime",
        referenced_stable_id: "table:public.post_attachments",
        deptype: "n",
      },
      {
        dependent_stable_id:
          "constraint:public.post_attachments.post_attachments_post_id_fkey",
        referenced_stable_id: "column:public.posts.id",
        deptype: "n",
      },
      {
        dependent_stable_id: "constraint:public.posts.posts_lab_id_fkey",
        referenced_stable_id: "constraint:public.labs.unique_lab_id",
        deptype: "n",
      },
    ]);
    const branchCatalog = await catalogWithDepends([]);

    const sorted = sortChanges({ mainCatalog, branchCatalog }, changes);

    expect(sorted.map(changeLabel)).toContain(
      "AlterTableDropConstraint:post_attachments.post_attachments_post_id_fkey",
    );
    expect(sorted.map(changeLabel)).toContain(
      "AlterTableDropConstraint:posts.posts_lab_id_fkey",
    );
  });

  test("orders signature replacement around a covered column default update", async () => {
    const mainProcedure = procedure(["integer"]);
    const branchProcedure = procedure(["bigint"]);
    const branchTable = table("items");
    const branchColumn = {
      ...integerColumn("value", 4),
      default: "public.normalize_value(1::bigint)",
    };
    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
      new AlterTableAlterColumnDropDefault({
        table: branchTable,
        column: branchColumn,
      }),
      new AlterTableAlterColumnSetDefault({
        table: branchTable,
        column: branchColumn,
      }),
    ];
    const mainCatalog = await catalogWithDepends([
      {
        dependent_stable_id: "column:public.items.value",
        referenced_stable_id: mainProcedure.stableId,
        deptype: "n",
      },
    ]);
    const branchCatalog = await catalogWithDepends([
      {
        dependent_stable_id: "column:public.items.value",
        referenced_stable_id: branchProcedure.stableId,
        deptype: "n",
      },
    ]);

    const sorted = sortChanges({ mainCatalog, branchCatalog }, changes);

    expect(sorted.map(changeLabel)).toEqual([
      "AlterTableAlterColumnDropDefault",
      `DropProcedure:${mainProcedure.stableId}`,
      `CreateProcedure:${branchProcedure.stableId}`,
      "AlterTableAlterColumnSetDefault",
    ]);
  });

  test("orders parent partition default restore before child default restore", async () => {
    const parentTable = table("partitioned_scores");
    const childTable = new Table({
      ...baseTableProps,
      name: "partitioned_scores_2026",
      columns: [
        { ...integerColumn("id", 1), not_null: true },
        integerColumn("post_id", 2),
        integerColumn("lab_id", 3),
      ],
      constraints: [],
      is_partition: true,
      parent_schema: "public",
      parent_name: "partitioned_scores",
      partition_bound: "FOR VALUES FROM (2026) TO (2027)",
    });
    const parentSetDefault = new AlterTableAlterColumnSetDefault({
      table: parentTable,
      column: {
        ...integerColumn("lab_id", 3),
        default: "public.normalize_value(1)",
      },
    });
    const childSetDefault = new AlterTableAlterColumnSetDefault({
      table: childTable,
      column: {
        ...integerColumn("lab_id", 3),
        default: "public.normalize_value(3)",
      },
    });
    const changes: Change[] = [childSetDefault, parentSetDefault];
    const mainCatalog = await catalogWithDepends([]);
    const branchCatalog = await catalogWithDepends([]);

    const sorted = sortChanges({ mainCatalog, branchCatalog }, changes);

    expect(sorted.indexOf(parentSetDefault)).toBeLessThan(
      sorted.indexOf(childSetDefault),
    );
  });

  test("orders domain default removal before dropping the referenced function", async () => {
    const mainProcedure = procedure(["integer"]);
    const mainDomain = domain("public.normalize_value(1)");
    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new AlterDomainDropDefault({ domain: mainDomain }),
    ];
    const mainCatalog = await catalogWithDepends([
      {
        dependent_stable_id: mainDomain.stableId,
        referenced_stable_id: mainProcedure.stableId,
        deptype: "n",
      },
    ]);
    const branchCatalog = await catalogWithDepends([]);

    const sorted = sortChanges({ mainCatalog, branchCatalog }, changes);

    expect(sorted.map(changeLabel)).toEqual([
      "AlterDomainDropDefault",
      `DropProcedure:${mainProcedure.stableId}`,
    ]);
  });

  test("orders unchanged domain check replacement around same-signature procedure replacement", async () => {
    const mainProcedure = procedure(["integer"]);
    const branchProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...mainProcedure,
      argument_names: ["renamed"],
    });
    const mainDomain = domainWithConstraint(
      "score_check",
      "public.normalize_value(VALUE) > 0",
    );
    const branchDomain = domainWithConstraint(
      "score_check",
      "public.normalize_value(VALUE) > 0",
    );
    const changes: Change[] = [
      new CreateProcedure({ procedure: branchProcedure }),
      new DropProcedure({ procedure: mainProcedure }),
      new AlterDomainAddConstraint({
        domain: branchDomain,
        constraint: branchDomain.constraints[0],
      }),
      new AlterDomainDropConstraint({
        domain: mainDomain,
        constraint: mainDomain.constraints[0],
      }),
    ];
    const mainCatalog = await catalogWithDepends([
      {
        dependent_stable_id: "constraint:public.score.score_check",
        referenced_stable_id: mainProcedure.stableId,
        deptype: "n",
      },
    ]);
    const branchCatalog = await catalogWithDepends([
      {
        dependent_stable_id: "constraint:public.score.score_check",
        referenced_stable_id: branchProcedure.stableId,
        deptype: "n",
      },
    ]);

    const sorted = sortChanges({ mainCatalog, branchCatalog }, changes);

    expect(sorted.map(changeLabel)).toEqual([
      "AlterDomainDropConstraint:score.score_check",
      `DropProcedure:${mainProcedure.stableId}`,
      `CreateProcedure:${branchProcedure.stableId}`,
      "AlterDomainAddConstraint:score.score_check",
    ]);
  });

  test("drops the old overloaded function before restoring expressions that can still resolve to it", async () => {
    const mainProcedure = procedure(["integer"]);
    const branchProcedure = procedure(["bigint"]);
    const mainTable = table("items", [
      checkConstraint("items_value_check", "public.normalize_value(id) > 0"),
    ]);
    const branchTable = table("items", [
      checkConstraint("items_value_check", "public.normalize_value(id) > 0"),
    ]);
    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
      new AlterTableAddConstraint({
        table: branchTable,
        constraint: branchTable.constraints[0],
      }),
      new AlterTableDropConstraint({
        table: mainTable,
        constraint: mainTable.constraints[0],
      }),
    ];
    const mainCatalog = await catalogWithDepends([
      {
        dependent_stable_id: "constraint:public.items.items_value_check",
        referenced_stable_id: mainProcedure.stableId,
        deptype: "n",
      },
    ]);
    const branchCatalog = await catalogWithDepends([
      {
        dependent_stable_id: "constraint:public.items.items_value_check",
        referenced_stable_id: branchProcedure.stableId,
        deptype: "n",
      },
    ]);

    const sorted = sortChanges({ mainCatalog, branchCatalog }, changes);

    expect(sorted.map(changeLabel)).toEqual([
      "AlterTableDropConstraint:items.items_value_check",
      `DropProcedure:${mainProcedure.stableId}`,
      `CreateProcedure:${branchProcedure.stableId}`,
      "AlterTableAddConstraint:items.items_value_check",
    ]);
  });

  test("drops the old overloaded function before restoring rebuilt views that can still resolve to it", async () => {
    const mainProcedure = procedure(["integer"]);
    const branchProcedure = procedure(["bigint"]);
    const mainView = view("score_view");
    const branchView = view("score_view");
    const changes: Change[] = [
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
      new CreateView({ view: branchView, orReplace: true }),
      new DropView({ view: mainView }),
    ];
    const mainCatalog = await catalogWithDepends([
      {
        dependent_stable_id: mainView.stableId,
        referenced_stable_id: mainProcedure.stableId,
        deptype: "n",
      },
    ]);
    const branchCatalog = await catalogWithDepends([
      {
        dependent_stable_id: branchView.stableId,
        referenced_stable_id: branchProcedure.stableId,
        deptype: "n",
      },
    ]);

    const sorted = sortChanges({ mainCatalog, branchCatalog }, changes);

    expect(sorted.map(changeLabel)).toEqual([
      "DropView",
      `DropProcedure:${mainProcedure.stableId}`,
      `CreateProcedure:${branchProcedure.stableId}`,
      "CreateView",
    ]);
  });

  test("drops defaulted old overloads before creating shorter replacements", async () => {
    const mainProcedure = new Procedure({
      // oxlint-disable-next-line typescript/no-misused-spread
      ...procedure(["integer", "integer"]),
      argument_default_count: 1,
      argument_defaults: "DEFAULT 1",
    });
    const branchProcedure = procedure(["integer"]);
    const changes: Change[] = [
      new CreateProcedure({ procedure: branchProcedure }),
      new DropProcedure({ procedure: mainProcedure }),
    ];
    const mainCatalog = await catalogWithDepends([]);
    const branchCatalog = await catalogWithDepends([]);

    const sorted = sortChanges({ mainCatalog, branchCatalog }, changes);

    expect(sorted.map(changeLabel)).toEqual([
      `DropProcedure:${mainProcedure.stableId}`,
      `CreateProcedure:${branchProcedure.stableId}`,
    ]);
  });

  test("drops old routines before dropping their old argument domains", async () => {
    const oldDomain = domain(null, "old_score");
    const mainProcedure = procedure(["public.old_score"]);
    const branchProcedure = procedure(["integer"]);
    const changes: Change[] = [
      new DropDomain({ domain: oldDomain }),
      new CreateProcedure({ procedure: branchProcedure }),
      new DropProcedure({ procedure: mainProcedure }),
    ];
    const mainCatalog = await catalogWithDepends([
      {
        dependent_stable_id: mainProcedure.stableId,
        referenced_stable_id: oldDomain.stableId,
        deptype: "n",
      },
    ]);
    const branchCatalog = await catalogWithDepends([]);

    const sorted = sortChanges({ mainCatalog, branchCatalog }, changes);

    expect(sorted.map(changeLabel)).toEqual([
      `DropProcedure:${mainProcedure.stableId}`,
      "DropDomain:old_score",
      `CreateProcedure:${branchProcedure.stableId}`,
    ]);
  });
});
