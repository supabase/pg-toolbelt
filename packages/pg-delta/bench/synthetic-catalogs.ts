/**
 * In-memory catalogs for sort benchmarks: diff(empty, synthetic) yields a large
 * CREATE/ALTER-heavy change list without Docker.
 */

import { Catalog } from "../src/core/catalog.model.ts";
import type { PgDepend } from "../src/core/depend.ts";
import type { ColumnProps } from "../src/core/objects/base.model.ts";
import type { PrivilegeProps } from "../src/core/objects/base.privilege-diff.ts";
import { Index } from "../src/core/objects/index/index.model.ts";
import { RlsPolicy } from "../src/core/objects/rls-policy/rls-policy.model.ts";
import { Role } from "../src/core/objects/role/role.model.ts";
import {
  Table,
  type TableConstraintProps,
} from "../src/core/objects/table/table.model.ts";

export type BenchScenario = "linearChain" | "star" | "dense" | "supabaseShaped";

const OWNER = "postgres";

const TABLE_SHELL = {
  schema: "public",
  persistence: "p" as const,
  force_row_security: false,
  has_rules: false,
  has_triggers: false,
  has_subclasses: false,
  is_populated: true,
  replica_identity: "d" as const,
  replica_identity_index: null as string | null,
  is_partition: false,
  options: null,
  partition_bound: null,
  partition_by: null,
  owner: OWNER,
  comment: null,
  parent_schema: null,
  parent_name: null,
};

function intColumn(
  name: string,
  position: number,
  notNull: boolean,
): ColumnProps {
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
    not_null: notNull,
    is_identity: false,
    is_identity_always: false,
    is_generated: false,
    collation: null,
    default: null,
    comment: null,
  };
}

function pkConstraint(name: string): TableConstraintProps {
  return {
    name,
    constraint_type: "p",
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
    check_expression: null,
    owner: OWNER,
    definition: "PRIMARY KEY (id)",
    comment: null,
  };
}

function fkConstraint(
  name: string,
  keyCols: readonly string[],
  refSchema: string,
  refTable: string,
  refCols: readonly string[],
): TableConstraintProps {
  return {
    name,
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
    key_columns: [...keyCols],
    foreign_key_columns: [...keyCols],
    foreign_key_table: refTable,
    foreign_key_schema: refSchema,
    foreign_key_table_is_partition: false,
    foreign_key_parent_schema: null,
    foreign_key_parent_table: null,
    foreign_key_effective_schema: refSchema,
    foreign_key_effective_table: refTable,
    on_update: "a",
    on_delete: "a",
    match_type: "u",
    check_expression: null,
    owner: OWNER,
    definition: `FOREIGN KEY (${keyCols.join(", ")}) REFERENCES ${refSchema}.${refTable}(${refCols.join(", ")})`,
    comment: null,
  };
}

function grantsThree(): PrivilegeProps[] {
  return [
    { grantee: "anon", privilege: "SELECT", grantable: false },
    { grantee: "authenticated", privilege: "INSERT", grantable: false },
    { grantee: "service_role", privilege: "UPDATE", grantable: false },
  ];
}

function makeIndex(
  schema: string,
  tableName: string,
  indexName: string,
  def: string,
): Index {
  return new Index({
    schema,
    table_name: tableName,
    name: indexName,
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
    key_columns: [1],
    column_collations: [null],
    operator_classes: [""],
    column_options: [0],
    index_expressions: null,
    partial_predicate: null,
    is_owned_by_constraint: false,
    table_relkind: "r",
    is_partitioned_index: false,
    is_index_partition: false,
    parent_index_name: null,
    definition: def,
    comment: null,
    owner: OWNER,
  });
}

function mergeCatalog(
  base: Catalog,
  patch: {
    tables?: Record<string, Table>;
    indexes?: Record<string, Index>;
    rlsPolicies?: Record<string, RlsPolicy>;
    roles?: Record<string, Role>;
    depends?: PgDepend[];
  },
): Catalog {
  const tables = { ...base.tables, ...patch.tables };
  const indexes = { ...base.indexes, ...patch.indexes };
  const rlsPolicies = { ...base.rlsPolicies, ...patch.rlsPolicies };
  const roles = patch.roles ?? base.roles;
  const depends = patch.depends
    ? [...base.depends, ...patch.depends]
    : base.depends;
  const indexableObjects = { ...base.indexableObjects };
  for (const t of Object.values(tables)) {
    indexableObjects[t.stableId] = t;
  }
  return new Catalog({
    aggregates: base.aggregates,
    collations: base.collations,
    compositeTypes: base.compositeTypes,
    domains: base.domains,
    enums: base.enums,
    extensions: base.extensions,
    procedures: base.procedures,
    indexes,
    materializedViews: base.materializedViews,
    subscriptions: base.subscriptions,
    publications: base.publications,
    rlsPolicies,
    roles,
    schemas: base.schemas,
    sequences: base.sequences,
    tables,
    triggers: base.triggers,
    eventTriggers: base.eventTriggers,
    rules: base.rules,
    ranges: base.ranges,
    views: base.views,
    foreignDataWrappers: base.foreignDataWrappers,
    servers: base.servers,
    userMappings: base.userMappings,
    foreignTables: base.foreignTables,
    depends,
    indexableObjects,
    version: base.version,
    currentUser: base.currentUser,
  });
}

export function buildSyntheticBranchCatalog(
  base: Catalog,
  scenario: BenchScenario,
  n: number,
): Catalog {
  if (n < 2 && (scenario === "linearChain" || scenario === "dense")) {
    throw new Error(`${scenario} requires n >= 2`);
  }
  if (n < 1 && scenario === "star") {
    throw new Error("star requires n >= 1 satellite(s)");
  }

  const newTables: Record<string, Table> = {};
  const newIndexes: Record<string, Index> = {};
  const newPolicies: Record<string, RlsPolicy> = {};

  if (scenario === "linearChain") {
    for (let i = 0; i < n; i++) {
      const name = `bench_lc_${i}`;
      const cols: ColumnProps[] = [intColumn("id", 1, true)];
      const constraints: TableConstraintProps[] = [
        pkConstraint(`${name}_pkey`),
      ];
      if (i < n - 1) {
        cols.push(intColumn("ref_next", 2, false));
        constraints.push(
          fkConstraint(
            `${name}_ref_fkey`,
            ["ref_next"],
            "public",
            `bench_lc_${i + 1}`,
            ["id"],
          ),
        );
      }
      newTables[`table:public.${name}`] = new Table({
        ...TABLE_SHELL,
        name,
        row_security: false,
        has_indexes: false,
        columns: cols,
        constraints,
        privileges: [],
      });
    }
  } else if (scenario === "star") {
    const root = "bench_star_r";
    newTables[`table:public.${root}`] = new Table({
      ...TABLE_SHELL,
      name: root,
      row_security: false,
      has_indexes: false,
      columns: [intColumn("id", 1, true)],
      constraints: [pkConstraint(`${root}_pkey`)],
      privileges: [],
    });
    for (let i = 0; i < n; i++) {
      const name = `bench_star_s_${i}`;
      newTables[`table:public.${name}`] = new Table({
        ...TABLE_SHELL,
        name,
        row_security: false,
        has_indexes: false,
        columns: [intColumn("id", 1, true), intColumn("root_id", 2, false)],
        constraints: [
          pkConstraint(`${name}_pkey`),
          fkConstraint(`${name}_root_fkey`, ["root_id"], "public", root, [
            "id",
          ]),
        ],
        privileges: [],
      });
    }
  } else if (scenario === "dense") {
    for (let i = 0; i < n; i++) {
      const name = `bench_dn_${i}`;
      const t1 = `bench_dn_${(i + 1) % n}`;
      const t2 = `bench_dn_${(i + 2) % n}`;
      const t3 = `bench_dn_${(i + 3) % n}`;
      newTables[`table:public.${name}`] = new Table({
        ...TABLE_SHELL,
        name,
        row_security: false,
        has_indexes: false,
        columns: [
          intColumn("id", 1, true),
          intColumn("r1", 2, false),
          intColumn("r2", 3, false),
          intColumn("r3", 4, false),
        ],
        constraints: [
          pkConstraint(`${name}_pkey`),
          fkConstraint(`${name}_f1`, ["r1"], "public", t1, ["id"]),
          fkConstraint(`${name}_f2`, ["r2"], "public", t2, ["id"]),
          fkConstraint(`${name}_f3`, ["r3"], "public", t3, ["id"]),
        ],
        privileges: [],
      });
    }
  } else if (scenario === "supabaseShaped") {
    const tableCount = Math.max(1, Math.floor(n / 3));
    for (let i = 0; i < tableCount; i++) {
      const name = `bench_sb_${i}`;
      newTables[`table:public.${name}`] = new Table({
        ...TABLE_SHELL,
        name,
        row_security: true,
        has_indexes: true,
        columns: [intColumn("id", 1, true), intColumn("payload", 2, false)],
        constraints: [pkConstraint(`${name}_pkey`)],
        privileges: grantsThree(),
      });
      const idx1 = `${name}_idx_a`;
      const idx2 = `${name}_idx_b`;
      newIndexes[`index:public.${name}.${idx1}`] = makeIndex(
        "public",
        name,
        idx1,
        `CREATE INDEX ${idx1} ON public.${name} USING btree (id)`,
      );
      newIndexes[`index:public.${name}.${idx2}`] = makeIndex(
        "public",
        name,
        idx2,
        `CREATE INDEX ${idx2} ON public.${name} USING btree (payload)`,
      );
      const polName = `${name}_bench_pol`;
      const pol = new RlsPolicy({
        schema: "public",
        name: polName,
        table_name: name,
        command: "r",
        permissive: true,
        roles: ["public"],
        using_expression: "true",
        with_check_expression: null,
        owner: OWNER,
        comment: null,
        referenced_relations: [],
        referenced_procedures: [],
      });
      newPolicies[pol.stableId] = pol;
    }
  }

  let roles = base.roles;
  if (scenario === "supabaseShaped") {
    const pg = base.roles["role:postgres"];
    if (pg) {
      roles = { ...base.roles };
      roles["role:postgres"] = new Role({
        ...pg,
        default_privileges: [
          ...pg.default_privileges,
          {
            in_schema: null,
            objtype: "r",
            grantee: "postgres",
            privileges: [{ privilege: "REFERENCES", grantable: false }],
            is_implicit: false,
          },
        ],
      });
    }
  }

  return mergeCatalog(base, {
    tables: newTables,
    indexes: newIndexes,
    rlsPolicies: newPolicies,
    roles,
  });
}
