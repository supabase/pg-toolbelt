/**
 * Security-label end-to-end proof (COVERAGE.md). Docker required: a
 * `postgres:<major>-alpine` image with the `dummy_seclabel` test module
 * compiled in and preloaded (tests/dummy-seclabel.Dockerfile,
 * tests/containers.ts::seclabelCluster).
 *
 * Extraction + rule rendering for SECURITY LABEL are unit-tested
 * (src/plan/security-label.test.ts). This proves the full create / change /
 * drop cycle APPLIES to a real database and re-extracts identically — the gap
 * COVERAGE.md flagged as environment-gated. The `dummy` provider stores labels
 * VERBATIM (no normalization → clean apply → re-extract → compare), unlike a
 * real provider that rewrites labels against its own grammar; it does validate
 * against a fixed vocabulary, so the labels below are drawn from its allowed
 * set: unclassified / classified / secret / top secret.
 *
 * Skips itself when PGDELTA_SKIP_DUMMY_SECLABEL_BUILD is set (sandboxes that
 * cannot build the image).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { provePlan } from "../src/proof/prove.ts";
import {
  seclabelCluster,
  skipSeclabelProof,
  type TestDb,
} from "./containers.ts";

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

/** Apply `fromSql` / `toSql` to two fresh DBs, plan from→to, and prove it on a
 *  clone of the `from` side (the real ordering + apply + re-extract check). */
async function proveTransition(
  name: string,
  fromSql: string,
  toSql: string,
): Promise<Awaited<ReturnType<typeof provePlan>> & { actions: number }> {
  const cluster = await seclabelCluster();
  const source = await cluster.createDb(`sl_${name}_src`);
  const desired = await cluster.createDb(`sl_${name}_dst`);
  dbs.push(source, desired);
  await source.pool.query(fromSql);
  await desired.pool.query(toSql);
  const sourceState = await extract(source.pool);
  const desiredState = await extract(desired.pool);
  const thePlan = plan(sourceState.factBase, desiredState.factBase);
  const clone = await source.clone();
  dbs.push(clone);
  const verdict = await provePlan(thePlan, clone.pool, desiredState.factBase);
  return { ...verdict, actions: thePlan.actions.length };
}

const BASE = `CREATE TABLE public.docs (id integer PRIMARY KEY, body text);`;
const tableLabel = (lbl: string) =>
  `${BASE}\nSECURITY LABEL FOR 'dummy' ON TABLE public.docs IS '${lbl}';`;

describe.skipIf(skipSeclabelProof)("security-label end-to-end proof", () => {
  test("create a security label on a table converges and applies", async () => {
    const v = await proveTransition("create", BASE, tableLabel("classified"));
    expect(v.actions).toBeGreaterThan(0); // a SECURITY LABEL action was planned
    expect(v.applyError).toBeUndefined();
    expect(v.driftDeltas).toEqual([]);
    expect(v.ok).toBe(true);
  }, 240_000);

  test("change a security label in place converges", async () => {
    const v = await proveTransition(
      "change",
      tableLabel("secret"),
      tableLabel("top secret"),
    );
    expect(v.applyError).toBeUndefined();
    expect(v.driftDeltas).toEqual([]);
    expect(v.ok).toBe(true);
  }, 240_000);

  test("drop a security label converges (IS NULL)", async () => {
    const v = await proveTransition("drop", tableLabel("classified"), BASE);
    expect(v.applyError).toBeUndefined();
    expect(v.driftDeltas).toEqual([]);
    expect(v.ok).toBe(true);
  }, 240_000);

  test("a column security label round-trips (objsubid path)", async () => {
    const v = await proveTransition(
      "column",
      BASE,
      `${BASE}\nSECURITY LABEL FOR 'dummy' ON COLUMN public.docs.body IS 'secret';`,
    );
    expect(v.applyError).toBeUndefined();
    expect(v.driftDeltas).toEqual([]);
    expect(v.ok).toBe(true);
  }, 240_000);
});
