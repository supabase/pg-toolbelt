import { describe, expect, test } from "bun:test";
import { Catalog, createEmptyCatalog } from "../catalog.model.ts";
import type { Change } from "../change.types.ts";
import type { PgDepend } from "../depend.ts";
import { CreateProcedure } from "../objects/procedure/changes/procedure.create.ts";
import { DropProcedure } from "../objects/procedure/changes/procedure.drop.ts";
import { Procedure } from "../objects/procedure/procedure.model.ts";
import { AlterPublicationDropTables } from "../objects/publication/changes/publication.alter.ts";
import { Publication } from "../objects/publication/publication.model.ts";
import {
  AlterTableAlterColumnType,
  AlterTableDropColumn,
  AlterTableDropConstraint,
} from "../objects/table/changes/table.alter.ts";
import { DropTable } from "../objects/table/changes/table.drop.ts";
import { Table } from "../objects/table/table.model.ts";
import { CreateEnum } from "../objects/type/enum/changes/enum.create.ts";
import { Enum } from "../objects/type/enum/enum.model.ts";
import { CreateView } from "../objects/view/changes/view.create.ts";
import { DropView } from "../objects/view/changes/view.drop.ts";
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

function enumColumn(
  name: string,
  position: number,
  schema: string,
  type: string,
) {
  return {
    ...integerColumn(name, position),
    data_type: "USER-DEFINED",
    data_type_str: `${schema}.${type}`,
    is_custom_type: true,
    custom_type_type: "e",
    custom_type_category: "E",
    custom_type_schema: schema,
    custom_type_name: type,
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

function enumType(name: string) {
  return new Enum({
    schema: "public",
    name,
    owner: "postgres",
    labels: [
      { sort_order: 1, label: "active" },
      { sort_order: 2, label: "blocked" },
    ],
    comment: null,
    privileges: [],
  });
}

function procedureReturningType(returnType: string) {
  return new Procedure({
    schema: "public",
    name: "account_status",
    kind: "f",
    return_type: returnType,
    return_type_schema: returnType.includes(".") ? "public" : "pg_catalog",
    language: "sql",
    security_definer: false,
    volatility: "s",
    parallel_safety: "u",
    execution_cost: 100,
    result_rows: 0,
    is_strict: false,
    leakproof: false,
    returns_set: false,
    argument_count: 0,
    argument_default_count: 0,
    argument_names: null,
    argument_types: [],
    all_argument_types: null,
    argument_modes: null,
    argument_defaults: null,
    source_code: "",
    binary_path: null,
    sql_body: "SELECT status FROM public.accounts WHERE id = 1",
    config: null,
    definition: `CREATE FUNCTION public.account_status() RETURNS ${returnType} LANGUAGE sql STABLE BEGIN ATOMIC SELECT status FROM public.accounts WHERE id = 1; END`,
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
  if (change instanceof CreateEnum) {
    return `${change.constructor.name}:${change.enum.stableId}`;
  }
  if (change instanceof CreateProcedure || change instanceof DropProcedure) {
    return `${change.constructor.name}:${change.procedure.stableId}`;
  }
  if (change instanceof AlterTableAlterColumnType) {
    return `${change.constructor.name}:${change.table.name}.${change.column.name}`;
  }
  if (change instanceof AlterTableDropColumn) {
    return `${change.constructor.name}:${change.table.name}.${change.column.name}`;
  }
  if (change instanceof AlterTableDropConstraint) {
    return `${change.constructor.name}:${change.table.name}.${change.constraint.name}`;
  }
  if (change instanceof AlterPublicationDropTables) {
    return `${change.constructor.name}:${change.publication.name}`;
  }
  if (change instanceof DropTable) {
    return `${change.constructor.name}:${change.table.name}`;
  }
  return change.constructor.name;
}

describe("sortChanges", () => {
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
      "AlterTableAlterColumnType:users.age",
      "CreateView",
    ]);
  });

  test("orders routine recreation after custom column type rewrite", async () => {
    const accountStatusType = enumType("account_status");
    const branchTable = table("accounts");
    const mainColumn = {
      ...integerColumn("status", 4),
      data_type: "text",
      data_type_str: "text",
    };
    const branchColumn = enumColumn("status", 4, "public", "account_status");
    const mainProcedure = procedureReturningType("text");
    const branchProcedure = procedureReturningType("public.account_status");
    const changes: Change[] = [
      new CreateEnum({ enum: accountStatusType }),
      new AlterTableAlterColumnType({
        table: branchTable,
        column: branchColumn,
        previousColumn: mainColumn,
      }),
      new DropProcedure({ procedure: mainProcedure }),
      new CreateProcedure({ procedure: branchProcedure }),
    ];
    const mainCatalog = await catalogWithDepends([
      {
        dependent_stable_id: mainProcedure.stableId,
        referenced_stable_id: "column:public.accounts.status",
        deptype: "n",
      },
    ]);
    const branchCatalog = await catalogWithDepends([
      {
        dependent_stable_id: branchProcedure.stableId,
        referenced_stable_id: "column:public.accounts.status",
        deptype: "n",
      },
    ]);

    const sorted = sortChanges({ mainCatalog, branchCatalog }, changes);

    expect(sorted.map(changeLabel)).toEqual([
      `DropProcedure:${mainProcedure.stableId}`,
      `CreateEnum:${accountStatusType.stableId}`,
      "AlterTableAlterColumnType:accounts.status",
      `CreateProcedure:${branchProcedure.stableId}`,
    ]);
  });

  test("orders publication table removal before generated column drop on the same table", async () => {
    const accounts = new Table({
      ...baseTableProps,
      name: "accounts",
      columns: [
        { ...integerColumn("id", 1), not_null: true },
        {
          ...integerColumn("status_label", 2),
          data_type: "text",
          data_type_str: "text",
          is_generated: true,
          default: "upper(id::text)",
        },
      ],
    });
    const publication = new Publication({
      name: "pub_accounts",
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
          name: "accounts",
          columns: ["id", "status_label"],
          row_filter: null,
        },
      ],
      schemas: [],
    });
    const changes: Change[] = [
      new AlterTableDropColumn({
        table: accounts,
        column: accounts.columns[1],
      }),
      new AlterPublicationDropTables({
        publication,
        tables: publication.tables,
      }),
    ];
    const mainCatalog = await catalogWithDepends([
      {
        dependent_stable_id: publication.stableId,
        referenced_stable_id: "column:public.accounts.status_label",
        deptype: "n",
      },
    ]);
    const branchCatalog = await catalogWithDepends([]);

    const sorted = sortChanges({ mainCatalog, branchCatalog }, changes);

    expect(sorted.map(changeLabel)).toEqual([
      "AlterPublicationDropTables:pub_accounts",
      "AlterTableDropColumn:accounts.status_label",
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
});
