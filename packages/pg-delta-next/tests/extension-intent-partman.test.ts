/**
 * Extension-intent Deliverable A, end-to-end against a real pg_partman DB
 * (docs/architecture/extension-intent.md §3.3, §4.3; CLI-1555 / CLI-1591).
 *
 * Reproduces the destructive bug — a declarative diff DROPs the partman child
 * partitions — and proves the pg_partman handler + `excludeManaged` stop it,
 * while leaving the partitioned parent intact. Uses the Supabase image, which
 * ships pg_partman.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { diff, type Delta } from "../src/core/diff.ts";
import { excludeManaged } from "../src/policy/managed.ts";
import {
  extractManaged,
  extractWithHandlers,
  pgPartmanHandler,
} from "../src/policy/extensions/index.ts";
import { plan } from "../src/plan/plan.ts";
import { provePlan } from "../src/proof/prove.ts";
import type { StableId } from "../src/core/stable-id.ts";
import { supabaseCluster, type TestDb } from "./containers.ts";

const eventsParent: StableId = {
  kind: "table",
  schema: "public",
  name: "events",
};

/** a `remove` of a partman child partition (public.events_* but not the parent) */
function dropsPartmanChild(deltas: Delta[]): boolean {
  return deltas.some(
    (d) =>
      d.verb === "remove" &&
      d.fact.id.kind === "table" &&
      d.fact.id.schema === "public" &&
      d.fact.id.name !== "events" &&
      d.fact.id.name.startsWith("events"),
  );
}

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

describe("extension-intent: pg_partman managed partitions are not dropped (CLI-1555)", () => {
  test("handler + excludeManaged stop the destructive drop, parent survives", async () => {
    const cluster = await supabaseCluster();

    // SOURCE: the live DB — partman creates child partitions at runtime
    const source = await cluster.createDb("partman_src");
    dbs.push(source);
    await source.pool.query(`CREATE SCHEMA IF NOT EXISTS partman`);
    await source.pool.query(
      `CREATE EXTENSION IF NOT EXISTS pg_partman WITH SCHEMA partman`,
    );
    await source.pool.query(
      `CREATE TABLE public.events (
           id bigint GENERATED ALWAYS AS IDENTITY,
           created_at timestamptz NOT NULL
         ) PARTITION BY RANGE (created_at)`,
    );
    await source.pool.query(
      `SELECT partman.create_parent(
           p_parent_table := 'public.events',
           p_control := 'created_at',
           p_interval := '1 day'
         )`,
    );

    // DESIRED: the declarative source — only the parent is declared
    const desired = await cluster.createDb("partman_dst");
    dbs.push(desired);
    await desired.pool.query(
      `CREATE TABLE public.events (
           id bigint GENERATED ALWAYS AS IDENTITY,
           created_at timestamptz NOT NULL
         ) PARTITION BY RANGE (created_at)`,
    );

    // CONTROL: a plain diff (no handler) DROPs the partman children
    const sourceRaw = await extract(source.pool);
    const desiredRaw = await extract(desired.pool);
    expect(
      dropsPartmanChild(diff(sourceRaw.factBase, desiredRaw.factBase)),
    ).toBe(true);

    // FIXED: handler tags children `managedBy`; excludeManaged removes them
    // from both sides → no drop, parent preserved.
    const sourceManaged = excludeManaged(
      (await extractWithHandlers(source.pool, [pgPartmanHandler])).factBase,
    );
    const desiredManaged = excludeManaged(
      (await extractWithHandlers(desired.pool, [pgPartmanHandler])).factBase,
    );
    const fixedDeltas = diff(sourceManaged, desiredManaged);

    expect(dropsPartmanChild(fixedDeltas)).toBe(false);
    expect(sourceManaged.has(eventsParent)).toBe(true);
  }, 180_000);

  test("the managed plan is proof-clean and preserves child rows (data-preservation)", async () => {
    const cluster = await supabaseCluster();
    const handlers = [pgPartmanHandler];

    // SOURCE: parent + partman children + a seeded row in a child
    const source = await cluster.createDb("partman_prove_src");
    dbs.push(source);
    await source.pool.query(`CREATE SCHEMA IF NOT EXISTS partman`);
    await source.pool.query(
      `CREATE EXTENSION IF NOT EXISTS pg_partman WITH SCHEMA partman`,
    );
    await source.pool.query(
      `CREATE TABLE public.events (
         id bigint GENERATED ALWAYS AS IDENTITY,
         created_at timestamptz NOT NULL
       ) PARTITION BY RANGE (created_at)`,
    );
    await source.pool.query(
      `SELECT partman.create_parent(
         p_parent_table := 'public.events',
         p_control := 'created_at',
         p_interval := '1 day'
       )`,
    );
    await source.pool.query(
      `INSERT INTO public.events (created_at) VALUES (now())`,
    );

    // DESIRED: the declarative source declares the extension + the partitioned
    // parent and makes a REAL parent change (adds a column), but does NOT run
    // create_parent — so it has no runtime children (Phase A). The plan does
    // real work (ALTER ADD COLUMN) yet must not touch the managed partitions.
    const desiredDb = await cluster.createDb("partman_prove_dst");
    dbs.push(desiredDb);
    await desiredDb.pool.query(`CREATE SCHEMA IF NOT EXISTS partman`);
    await desiredDb.pool.query(
      `CREATE EXTENSION IF NOT EXISTS pg_partman WITH SCHEMA partman`,
    );
    await desiredDb.pool.query(
      `CREATE TABLE public.events (
         id bigint GENERATED ALWAYS AS IDENTITY,
         created_at timestamptz NOT NULL,
         note text
       ) PARTITION BY RANGE (created_at)`,
    );

    const sourceFb = (await extractManaged(source.pool, handlers)).factBase;
    const desiredFb = (await extractManaged(desiredDb.pool, handlers)).factBase;
    const thePlan = plan(sourceFb, desiredFb, {
      renames: "off",
      compact: true,
    });

    // prove against a sacrificial clone of the source, re-extracting with the
    // SAME managed-aware extractor so the proof stays consistent.
    const clone = await source.clone();
    dbs.push(clone);
    const verdict = await provePlan(thePlan, clone.pool, desiredFb, {
      reextract: (pool) => extractManaged(pool, handlers),
    });

    expect(verdict.applyError).toBeUndefined();
    expect(verdict.driftDeltas).toEqual([]);
    expect(verdict.dataViolations).toEqual([]);
    expect(verdict.ok).toBe(true);
    // the proof reports honest coverage; the seeded child partition is checked.
    // Its schema changed (the parent's new column propagated), so it is
    // count-checked, not falsely flagged as a content violation.
    expect(verdict.coverage.tablesChecked).toBeGreaterThan(0);

    // the seeded child row survived the migration on the clone
    const { rows } = await clone.pool.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM public.events`,
    );
    expect(rows[0]?.c).toBe(1);
  }, 180_000);
});
