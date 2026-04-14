import { describe, expect, test } from "bun:test";
import { Catalog, createEmptyCatalog } from "./catalog.model.ts";
import type { Change } from "./change.types.ts";
import { expandReplaceDependencies } from "./expand-replace-dependencies.ts";
import { DefaultPrivilegeState } from "./objects/base.default-privileges.ts";
import { CreateSequence } from "./objects/sequence/changes/sequence.create.ts";
import { DropSequence } from "./objects/sequence/changes/sequence.drop.ts";
import { diffSequences } from "./objects/sequence/sequence.diff.ts";
import { Sequence } from "./objects/sequence/sequence.model.ts";
import { AlterTableAlterColumnSetDefault } from "./objects/table/changes/table.alter.ts";
import { CreateTable } from "./objects/table/changes/table.create.ts";
import { DropTable } from "./objects/table/changes/table.drop.ts";
import { Table } from "./objects/table/table.model.ts";

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
    requires: [],
    table: { schema: "public", name: "t" },
    serialize: () => [],
    get requiresForDrop(): string[] {
      return [];
    },
  } as unknown as Change;
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
    expect(result).toHaveLength(1);
    expect(result).toBe(changes);
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
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(changes[0]);
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
    expect(result).toBe(changes);
  });

  test("does not replace the owning table for an owned sequence recreation", async () => {
    const baseline = await createEmptyCatalog(170000, "postgres");
    const mainSequence = new Sequence({
      schema: "public",
      name: "user_id_seq",
      data_type: "integer",
      start_value: 1,
      minimum_value: 1n,
      maximum_value: 2147483647n,
      increment: 1,
      cycle_option: false,
      cache_size: 1,
      persistence: "p",
      owned_by_schema: "public",
      owned_by_table: "users",
      owned_by_column: "id",
      comment: null,
      privileges: [],
      owner: "postgres",
    });
    const branchSequence = new Sequence({
      ...mainSequence,
      data_type: "bigint",
      maximum_value: 9223372036854775807n,
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
    expect(expanded.some((change) => change instanceof DropTable)).toBe(false);
    expect(expanded.some((change) => change instanceof CreateTable)).toBe(
      false,
    );
  });
});
