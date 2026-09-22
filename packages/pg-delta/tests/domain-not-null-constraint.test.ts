/**
 * PG 17+ catalogs a domain NOT NULL as a pg_constraint row (contype 'n'). It
 * must stay the domain's `notNull` attribute, not a second constraint fact or
 * a dependency edge, or CREATE DOMAIN renders NOT NULL twice (issue #482).
 * Docker required; the duplicate row only exists on PG 17+.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { createTestDb, type TestDb } from "./containers.ts";

let empty: TestDb;
let nullable: TestDb;
let notNull: TestDb;

const DOMAIN_SQL = (notNull: boolean) => `
  CREATE SCHEMA core;
  CREATE DOMAIN core.percentage AS numeric(7, 6) DEFAULT 0
    CONSTRAINT percentage_between_0_and_1 CHECK (VALUE >= 0 AND VALUE <= 1)
    ${notNull ? "NOT NULL" : ""};
`;

beforeAll(async () => {
  empty = await createTestDb("dom_nn_empty");
  nullable = await createTestDb("dom_nn_nullable");
  notNull = await createTestDb("dom_nn_notnull");
  await empty.pool.query(`CREATE SCHEMA core;`);
  await nullable.pool.query(DOMAIN_SQL(false));
  await notNull.pool.query(DOMAIN_SQL(true));
}, 120_000);

afterAll(async () => {
  await Promise.all([empty.drop(), nullable.drop(), notNull.drop()]);
});

const domainSql = (actions: ReadonlyArray<{ sql: string }>) =>
  actions
    .map((a) => a.sql)
    .filter((sql) => /DOMAIN/.test(sql) && !/OWNER TO/.test(sql));

describe("domain NOT NULL is not a constraint fact", () => {
  test("CREATE DOMAIN renders NOT NULL exactly once", async () => {
    const [a, b] = [await extract(empty.pool), await extract(notNull.pool)];
    const sql = domainSql(plan(a.factBase, b.factBase).actions);
    expect(sql).toMatchInlineSnapshot(`
      [
        "CREATE DOMAIN "core"."percentage" AS numeric(7,6) DEFAULT 0 NOT NULL CONSTRAINT "percentage_between_0_and_1" CHECK (((VALUE >= (0)::numeric) AND (VALUE <= (1)::numeric)))",
      ]
    `);
  });

  test("the catalogued NOT NULL row is not a dangling dependency edge", async () => {
    const { diagnostics } = await extract(notNull.pool);
    expect(diagnostics).toEqual([]);
  });

  test("toggling NOT NULL emits only ALTER DOMAIN SET/DROP NOT NULL", async () => {
    const [a, b] = [await extract(nullable.pool), await extract(notNull.pool)];
    expect(domainSql(plan(a.factBase, b.factBase).actions)).toEqual([
      `ALTER DOMAIN "core"."percentage" SET NOT NULL`,
    ]);
    expect(domainSql(plan(b.factBase, a.factBase).actions)).toEqual([
      `ALTER DOMAIN "core"."percentage" DROP NOT NULL`,
    ]);
  });
});
