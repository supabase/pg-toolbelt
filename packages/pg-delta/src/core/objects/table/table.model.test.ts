import { describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import { extractTables, Table } from "./table.model.ts";

// Minimal fields required by tablePropsSchema; individual tests override the
// constraints array (and any other relevant fields).
const baseTableRow = {
  schema: "public",
  name: '"users"',
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
  columns: [],
  privileges: [],
};

const baseConstraint = {
  name: '"users_pkey"',
  constraint_type: "p" as const,
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
  key_columns: ['"id"'],
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
  comment: null,
};

const mockPool = (rows: unknown[]): Pool =>
  ({ query: async () => ({ rows }) }) as unknown as Pool;

const mockPoolSequence = (...attempts: unknown[][]): Pool => {
  let i = 0;
  return {
    query: async () => ({
      rows: attempts[Math.min(i++, attempts.length - 1)],
    }),
  } as unknown as Pool;
};

const NO_BACKOFF = { backoffMs: 0 } as const;

describe("extractTables", () => {
  test("skips constraints where pg_get_constraintdef returned NULL after exhausting retries", async () => {
    const tables = await extractTables(
      mockPool([
        {
          ...baseTableRow,
          constraints: [
            {
              ...baseConstraint,
              name: '"users_pkey"',
              definition: "PRIMARY KEY (id)",
            },
            {
              ...baseConstraint,
              name: '"users_orphan_chk"',
              constraint_type: "c",
              key_columns: [],
              definition: null,
            },
          ],
        },
      ]),
      NO_BACKOFF,
    );

    expect(tables).toHaveLength(1);
    expect(tables[0]).toBeInstanceOf(Table);
    expect(tables[0]?.constraints).toHaveLength(1);
    expect(tables[0]?.constraints[0]?.name).toBe('"users_pkey"');
    expect(tables[0]?.constraints[0]?.definition).toBe("PRIMARY KEY (id)");
  });

  test("does not throw ZodError when every constraint has a null definition", async () => {
    const tables = await extractTables(
      mockPool([
        {
          ...baseTableRow,
          constraints: [
            {
              ...baseConstraint,
              name: '"orphan_a"',
              constraint_type: "c",
              key_columns: [],
              definition: null,
            },
            {
              ...baseConstraint,
              name: '"orphan_b"',
              constraint_type: "c",
              key_columns: [],
              definition: null,
            },
          ],
        },
      ]),
      NO_BACKOFF,
    );

    expect(tables).toHaveLength(1);
    expect(tables[0]?.constraints).toEqual([]);
  });

  test("returns all constraints when every definition is valid", async () => {
    const tables = await extractTables(
      mockPool([
        {
          ...baseTableRow,
          constraints: [
            {
              ...baseConstraint,
              name: '"users_pkey"',
              definition: "PRIMARY KEY (id)",
            },
            {
              ...baseConstraint,
              name: '"users_email_key"',
              constraint_type: "u",
              key_columns: ['"email"'],
              definition: "UNIQUE (email)",
            },
          ],
        },
      ]),
      NO_BACKOFF,
    );

    expect(tables[0]?.constraints.map((c) => c.name)).toEqual([
      '"users_pkey"',
      '"users_email_key"',
    ]);
  });

  test("recovers when pg_get_constraintdef is NULL on first attempt but resolved on retry", async () => {
    const tables = await extractTables(
      mockPoolSequence(
        // attempt 1: one constraint has NULL definition
        [
          {
            ...baseTableRow,
            constraints: [
              {
                ...baseConstraint,
                name: '"users_racy_chk"',
                constraint_type: "c",
                key_columns: [],
                definition: null,
              },
            ],
          },
        ],
        // attempt 2: constraint resolves on retry
        [
          {
            ...baseTableRow,
            constraints: [
              {
                ...baseConstraint,
                name: '"users_racy_chk"',
                constraint_type: "c",
                key_columns: [],
                definition: "CHECK (id > 0)",
              },
            ],
          },
        ],
      ),
      { retries: 2, backoffMs: 0 },
    );
    expect(tables).toHaveLength(1);
    expect(tables[0]?.constraints).toHaveLength(1);
    expect(tables[0]?.constraints[0]?.name).toBe('"users_racy_chk"');
    expect(tables[0]?.constraints[0]?.definition).toBe("CHECK (id > 0)");
  });
});
