/**
 * Postgres rejects ALTER COLUMN ... TYPE and DROP COLUMN on a column in the
 * partition key of its table or of any sub-partition ("cannot alter column ...
 * because it is part of the partition key of relation ..."). The plan must
 * replace the partitioned table.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { plan } from "./plan.ts";

const s1: StableId = { kind: "schema", name: "s1" };
const t: StableId = { kind: "table", schema: "s1", name: "t" };
const key = { _partitionKey: true };

const column = (name: string, type: string, extra = {}): Fact => ({
  id: { kind: "column", schema: "s1", table: "t", name },
  parent: t,
  payload: {
    type,
    notNull: false,
    identity: null,
    collation: null,
    generatedExpr: null,
    ...extra,
  },
});

const base = (columns: Fact[]) =>
  buildFactBase(
    [
      { id: s1, payload: {} },
      {
        id: t,
        parent: s1,
        payload: {
          persistence: "p",
          rowSecurity: false,
          forceRowSecurity: false,
          replicaIdentity: "d",
          replicaIdentityIndex: null,
          partitionKey: "RANGE (k)",
          partitionBound: null,
          parentTable: null,
          reloptions: null,
        },
      },
      ...columns,
    ],
    [],
  );

const sqlsFor = (from: Fact[], to: Fact[]) =>
  plan(base(from), base(to)).actions.map((a) => a.sql);

describe("partition key column changes", () => {
  test("a type change on a partition key column replaces the table", () => {
    const sqls = sqlsFor(
      [column("k", "timestamp with time zone", key)],
      [column("k", "timestamp without time zone", key)],
    );
    expect(sqls).toContain(`DROP TABLE "s1"."t"`);
    expect(sqls).toContain(
      `CREATE TABLE "s1"."t" ("k" timestamp without time zone) PARTITION BY RANGE (k)`,
    );
    expect(sqls.some((s) => s.includes(`ALTER COLUMN`))).toBe(false);
  });

  test("a type change on a non-key column stays in place", () => {
    const sqls = sqlsFor(
      [column("k", "date", key), column("v", "json")],
      [column("k", "date", key), column("v", "jsonb")],
    );
    expect(sqls).toContain(
      `ALTER TABLE "s1"."t" ALTER COLUMN "v" TYPE jsonb USING "v"::jsonb`,
    );
    expect(sqls.some((s) => s.startsWith(`DROP TABLE`))).toBe(false);
  });

  test("a collation change on a partition key column replaces the table", () => {
    const sqls = sqlsFor(
      [column("k", "text", key)],
      [column("k", "text", { ...key, collation: `pg_catalog."C"` })],
    );
    expect(sqls).toContain(`DROP TABLE "s1"."t"`);
    expect(sqls.some((s) => s.includes(`DROP COLUMN`))).toBe(false);
  });
});
