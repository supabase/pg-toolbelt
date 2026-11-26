/**
 * Dropping a child that redeclares a parent column, together with the parent's
 * column and a function that reads it. The child's CHECK calls the function,
 * whose BEGIN ATOMIC body depends on the parent column, so ordering the
 * parent's DROP COLUMN after the child's own column (as a "release" edge would)
 * closes a cycle through the dropped child table.
 *
 * Forward only: the reverse direction creates the redeclaring child, which the
 * corpus pins as a known gap (tests/expected-red.ts), so this shape cannot be a
 * corpus scenario until that is fixed.
 */
import { expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { provePlan } from "../src/proof/prove.ts";
import { sharedCluster } from "./containers.ts";

test("drop a redeclaring child, its check function and the parent column", async () => {
  const cluster = await sharedCluster();
  const source = await cluster.createDb("inh_redecl_src");
  const desired = await cluster.createDb("inh_redecl_dst");
  try {
    await source.pool.query(`
      CREATE SCHEMA s;
      CREATE TABLE s.p (id int, x int);
      CREATE FUNCTION s.f(int) RETURNS boolean LANGUAGE sql
        BEGIN ATOMIC SELECT count(*) >= 0 FROM s.p WHERE p.x = $1; END;
      CREATE TABLE s.c (x int, CHECK (s.f(id))) INHERITS (s.p);
      INSERT INTO s.p VALUES (1, 1);
    `);
    await desired.pool.query(`
      CREATE SCHEMA s;
      CREATE TABLE s.p (id int);
    `);
    const [s, d] = [await extract(source.pool), await extract(desired.pool)];
    const thePlan = plan(s.factBase, d.factBase);
    expect(thePlan.actions.map((a) => a.sql)).toMatchInlineSnapshot(`
      [
        "DROP TABLE "s"."c"",
        "DROP FUNCTION "s"."f"(integer)",
        "ALTER TABLE "s"."p" DROP COLUMN "x"",
      ]
    `);
    const verdict = await provePlan(thePlan, source.pool, d.factBase);
    expect(verdict.ok).toBe(true);
  } finally {
    await Promise.all([source.drop(), desired.drop()]);
  }
}, 60_000);
