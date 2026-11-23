/**
 * Stage 6 integration suite: segmented execution, mid-plan failure
 * reporting, the fingerprint gate, artifact round-trip through a real
 * apply, CREATE INDEX CONCURRENTLY, and render-from-fact-base
 * materialization.
 */
import { describe, expect, test } from "bun:test";
import { apply } from "../src/apply/apply.ts";
import {
  deserializeSnapshot,
  serializeSnapshot,
} from "../src/core/snapshot.ts";
import { extract } from "../src/extract/extract.ts";
import {
  computePlanId,
  parsePlan,
  serializePlan,
} from "../src/plan/artifact.ts";
import { plan } from "../src/plan/plan.ts";
import { provePlan } from "../src/proof/prove.ts";
import { sharedCluster } from "./containers.ts";

describe("stage 6: execution", () => {
  test("mid-plan failure reports applied/unapplied per action", async () => {
    const cluster = await sharedCluster();
    const db = await cluster.createDb("exec_fail");
    try {
      // build a plan, then sabotage a mid-plan action so a later segment
      // boundary has already committed segment 1
      const desired = await cluster.createDb("exec_fail_desired");
      try {
        await desired.pool.query(`
          CREATE SCHEMA app;
          CREATE TYPE app.status AS ENUM ('a');
          CREATE TABLE app.t (id integer);
        `);
        const [sourceState, desiredState] = [
          await extract(db.pool),
          await extract(desired.pool),
        ];
        const thePlan = plan(sourceState.factBase, desiredState.factBase);
        // sabotage the LAST action; everything before it is one segment
        const last = thePlan.actions.length - 1;
        thePlan.actions[last]!.sql = "SELECT 1/0";
        thePlan.planId = computePlanId(thePlan); // re-stamp the sabotage past apply's planId gate
        const report = await apply(thePlan, db.pool, {
          fingerprintGate: false,
        });
        expect(report.status).toBe("failed");
        expect(report.error?.actionIndex).toBe(last);
        // single transactional segment → everything rolled back
        expect(report.actionStatuses.every((s) => s === "unapplied")).toBe(
          true,
        );
        expect(report.appliedActions).toBe(0);
      } finally {
        await desired.drop();
      }
    } finally {
      await db.drop();
    }
  }, 60_000);

  test("a failure after a committed segment leaves earlier actions applied", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("exec_seg_src");
    const desired = await cluster.createDb("exec_seg_dst");
    try {
      await source.pool.query(`
        CREATE SCHEMA app;
        CREATE TYPE app.status AS ENUM ('a');
        CREATE TABLE app.t (s app.status);
      `);
      // adding a value AND a view that uses it forces a commit boundary
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TYPE app.status AS ENUM ('a', 'b');
        CREATE TABLE app.t (s app.status);
        CREATE VIEW app.v AS SELECT s FROM app.t WHERE s = 'b';
      `);
      const [sourceState, desiredState] = [
        await extract(source.pool),
        await extract(desired.pool),
      ];
      const thePlan = plan(sourceState.factBase, desiredState.factBase);
      const boundaryPos = thePlan.actions.findIndex((a) => a.newSegmentBefore);
      expect(boundaryPos).toBeGreaterThan(0);
      // sabotage an action AFTER the boundary: segment 1 must stay applied
      thePlan.actions[boundaryPos]!.sql = "SELECT 1/0";
      thePlan.planId = computePlanId(thePlan); // re-stamp the sabotage past apply's planId gate
      const report = await apply(thePlan, source.pool, {
        fingerprintGate: false,
      });
      expect(report.status).toBe("failed");
      expect(
        report.actionStatuses
          .slice(0, boundaryPos)
          .every((s) => s === "applied"),
      ).toBe(true);
      expect(
        report.actionStatuses
          .slice(boundaryPos)
          .every((s) => s === "unapplied"),
      ).toBe(true);
      expect(report.appliedActions).toBe(boundaryPos);
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 60_000);

  test("a backfill fits between SET DEFAULT and SET NOT NULL", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("exec_backfill_src");
    const desired = await cluster.createDb("exec_backfill_dst");
    try {
      await source.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (status text);
        INSERT INTO app.t VALUES (NULL);
      `);
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (status text NOT NULL DEFAULT 'new');
      `);
      const [sourceState, desiredState] = [
        await extract(source.pool),
        await extract(desired.pool),
      ];
      const sql = plan(sourceState.factBase, desiredState.factBase).actions.map(
        (a) => a.sql,
      );
      await source.pool.query("BEGIN");
      for (const statement of sql) {
        await source.pool.query(statement);
        if (statement.includes("SET DEFAULT")) {
          await source.pool.query(
            "UPDATE app.t SET status = DEFAULT WHERE status IS NULL",
          );
        }
      }
      await source.pool.query("COMMIT");
      const { rows } = await source.pool.query("SELECT status FROM app.t");
      expect(rows).toEqual([{ status: "new" }]);
      const { rows: notNull } = await source.pool.query(
        "SELECT attnotnull FROM pg_attribute WHERE attrelid = 'app.t'::regclass AND attname = 'status'",
      );
      expect(notNull).toEqual([{ attnotnull: true }]);
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 60_000);

  test("a failed SET NOT NULL is not pushed past an enum ADD VALUE commit", async () => {
    // the NULL row fails SET NOT NULL; it must fail before the commit, so the
    // whole apply rolls back. The default reaches the new enum value in the
    // first case; in the second only the tie-break puts ADD VALUE first.
    const cases = [
      {
        source: `
          CREATE TYPE app.mood AS ENUM ('busy');
          CREATE FUNCTION app.old_status() RETURNS text LANGUAGE sql AS 'SELECT 1::text';
          CREATE TABLE app.t (status text DEFAULT app.old_status());`,
        desired: `
          CREATE TYPE app.mood AS ENUM ('busy', 'calm');
          CREATE TABLE app.t (status text NOT NULL DEFAULT 'calm'::app.mood);`,
      },
      {
        source: `
          CREATE TYPE app.mood AS ENUM ('busy');
          CREATE TABLE app.t (status text);`,
        desired: `
          CREATE TYPE app.mood AS ENUM ('busy', 'calm');
          CREATE FUNCTION app.f() RETURNS text LANGUAGE sql AS 'SELECT 1::text';
          CREATE TABLE app.t (status text NOT NULL DEFAULT app.f());`,
      },
    ];
    const cluster = await sharedCluster();
    for (const c of cases) {
      const source = await cluster.createDb("exec_notnull_src");
      const desired = await cluster.createDb("exec_notnull_dst");
      try {
        await source.pool.query(
          `CREATE SCHEMA app; ${c.source} INSERT INTO app.t VALUES (NULL);`,
        );
        await desired.pool.query(`CREATE SCHEMA app; ${c.desired}`);
        const [sourceState, desiredState] = [
          await extract(source.pool),
          await extract(desired.pool),
        ];
        const thePlan = plan(sourceState.factBase, desiredState.factBase);
        const report = await apply(thePlan, source.pool, {
          fingerprintGate: false,
        });
        expect(report.status).toBe("failed");
        // the persisted schema is exactly the source's
        expect((await extract(source.pool)).factBase.rootHash).toBe(
          sourceState.factBase.rootHash,
        );
        expect(report.appliedActions).toBe(0);
      } finally {
        await Promise.all([source.drop(), desired.drop()]);
      }
    }
  }, 60_000);

  test("a failed SET NOT NULL commits nothing after ADD VALUE", async () => {
    // ADD VALUE commits in both orders. Default-first must not commit the
    // default, or an unrelated statement it lets go first, before SET NOT
    // NULL fails on the NULL row.
    const cases = [
      {
        shared: `CREATE DOMAIN app.dm AS app.mood;
          CREATE FUNCTION app.d() RETURNS app.mood LANGUAGE plpgsql AS $$BEGIN RETURN 'busy'; END$$;`,
        source: "CREATE TABLE app.t (m app.dm);",
        desired: "CREATE TABLE app.t (m app.dm NOT NULL DEFAULT app.d());",
      },
      {
        shared: `CREATE FUNCTION app.d() RETURNS text LANGUAGE sql AS $$SELECT 'busy'$$;`,
        source: "CREATE TABLE app.t (m app.mood); CREATE TABLE app.z (id int);",
        desired: `CREATE TABLE app.t (m app.mood NOT NULL DEFAULT app.d()::app.mood);
          CREATE TABLE app.z (id int CHECK (id > 0));`,
      },
    ];
    const cluster = await sharedCluster();
    for (const c of cases) {
      const source = await cluster.createDb("exec_default_seg_src");
      const desired = await cluster.createDb("exec_default_seg_dst");
      try {
        await source.pool.query(`CREATE SCHEMA app;
          CREATE TYPE app.mood AS ENUM ('busy'); ${c.shared} ${c.source}
          INSERT INTO app.t VALUES (NULL);`);
        await desired.pool.query(`CREATE SCHEMA app;
          CREATE TYPE app.mood AS ENUM ('busy', 'calm'); ${c.shared} ${c.desired}`);
        const thePlan = plan(
          (await extract(source.pool)).factBase,
          (await extract(desired.pool)).factBase,
        );
        const report = await apply(thePlan, source.pool, {
          fingerprintGate: false,
        });
        expect(report.status).toBe("failed");
        expect(report.appliedActions).toBe(1);
      } finally {
        await Promise.all([source.drop(), desired.drop()]);
      }
    }
  }, 60_000);

  test("new columns keep declared order when SET NOT NULL waits for the default", async () => {
    // g and h are generated through functions, so only the tie-break orders
    // them; default-first must not delay one behind the other.
    const f = `CREATE FUNCTION app.f(text) RETURNS text IMMUTABLE LANGUAGE sql AS 'SELECT $1';`;
    const atomic = (name: string, column: string, table: string) =>
      `CREATE FUNCTION app.${name}() RETURNS text IMMUTABLE LANGUAGE sql BEGIN ATOMIC SELECT max(${column}) FROM app.${table}; END;`;
    const cases = [
      {
        source: `${f} CREATE TABLE app.t (s text, x text);`,
        desired: `${f} CREATE TABLE app.t (s text NOT NULL DEFAULT app.f('new'), x text,
          g text GENERATED ALWAYS AS (app.f(s)) STORED,
          h text GENERATED ALWAYS AS (app.f(x)) STORED);`,
        columns: ["s", "x", "g", "h"],
      },
      {
        source: `${f} CREATE TABLE app.t (s text);
          CREATE TABLE app.u (s text); CREATE TABLE app.v (s text);`,
        desired: `${f} CREATE TABLE app.t (s text NOT NULL DEFAULT app.f('new'));
          CREATE TABLE app.u (s text); CREATE TABLE app.v (s text);
          ${atomic("fs", "s", "t")}
          ALTER TABLE app.u ADD COLUMN c text GENERATED ALWAYS AS (app.fs()) STORED;
          ALTER TABLE app.v ADD COLUMN c text GENERATED ALWAYS AS (app.f(s)) STORED;
          ${atomic("fg", "c", "u")} ${atomic("fh", "c", "v")}
          ALTER TABLE app.t ADD COLUMN g text GENERATED ALWAYS AS (app.fg()) STORED;
          ALTER TABLE app.t ADD COLUMN h text GENERATED ALWAYS AS (app.f(s) || app.fh()) STORED;`,
        columns: ["s", "g", "h"],
      },
    ];
    const cluster = await sharedCluster();
    for (const c of cases) {
      const source = await cluster.createDb("exec_colorder_src");
      const desired = await cluster.createDb("exec_colorder_dst");
      try {
        await source.pool.query(`CREATE SCHEMA app; ${c.source}`);
        await desired.pool.query(`CREATE SCHEMA app; ${c.desired}`);
        const thePlan = plan(
          (await extract(source.pool)).factBase,
          (await extract(desired.pool)).factBase,
        );
        const report = await apply(thePlan, source.pool, {
          fingerprintGate: false,
        });
        expect(report.status).toBe("applied");
        const { rows } = await source.pool.query(
          "SELECT attname FROM pg_attribute WHERE attrelid = 'app.t'::regclass AND attnum > 0 ORDER BY attnum",
        );
        expect(rows.map((r) => r.attname)).toEqual(c.columns);
      } finally {
        await Promise.all([source.drop(), desired.drop()]);
      }
    }
  }, 60_000);

  test("fingerprint gate refuses a stale plan", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("exec_gate_src");
    const desired = await cluster.createDb("exec_gate_dst");
    try {
      await desired.pool.query(`CREATE SCHEMA app`);
      const [sourceState, desiredState] = [
        await extract(source.pool),
        await extract(desired.pool),
      ];
      const thePlan = plan(sourceState.factBase, desiredState.factBase);
      // mutate the target AFTER planning: the gate must refuse
      await source.pool.query(`CREATE SCHEMA sneaky`);
      expect(apply(thePlan, source.pool)).rejects.toThrow(
        /fingerprint gate failed/,
      );
      // un-mutate; the gate passes and the plan applies
      await source.pool.query(`DROP SCHEMA sneaky`);
      const report = await apply(thePlan, source.pool);
      expect(report.status).toBe("applied");
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 60_000);

  test("plans survive artifact serialization and apply from the parsed form", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("exec_art_src");
    const desired = await cluster.createDb("exec_art_dst");
    try {
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE SEQUENCE app.seq START 42;
        CREATE TABLE app.t (id bigint DEFAULT nextval('app.seq'));
      `);
      const [sourceState, desiredState] = [
        await extract(source.pool),
        await extract(desired.pool),
      ];
      const thePlan = plan(sourceState.factBase, desiredState.factBase);
      const reparsed = parsePlan(serializePlan(thePlan));
      expect(reparsed).toEqual(thePlan);
      const verdict = await provePlan(
        reparsed,
        source.pool,
        desiredState.factBase,
      );
      expect(verdict.ok).toBe(true);
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 60_000);

  test("concurrentIndexes param emits CREATE INDEX CONCURRENTLY outside transactions", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("exec_cic_src");
    const desired = await cluster.createDb("exec_cic_dst");
    try {
      await source.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id integer, x text);
        INSERT INTO app.t SELECT i, i::text FROM generate_series(1, 50) i;
      `);
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id integer, x text);
        CREATE INDEX t_x_idx ON app.t (x);
      `);
      const [sourceState, desiredState] = [
        await extract(source.pool),
        await extract(desired.pool),
      ];
      const thePlan = plan(sourceState.factBase, desiredState.factBase, {
        params: { concurrentIndexes: true },
      });
      const indexAction = thePlan.actions.find((a) =>
        a.sql.includes("INDEX CONCURRENTLY"),
      );
      expect(indexAction?.transactionality).toBe("nonTransactional");
      expect(indexAction?.lockClass).toBe("shareUpdateExclusive");
      const report = await apply(thePlan, source.pool, {
        fingerprintGate: false,
      });
      expect(report.status).toBe("applied");
      // the state converges to the SAME fact base as a plain CREATE INDEX
      const proven = await extract(source.pool);
      expect(proven.factBase.rootHash).toBe(desiredState.factBase.rootHash);
      // and the seeded rows survived
      const rows = await source.pool.query(
        `SELECT count(*)::int AS n FROM app.t`,
      );
      expect((rows.rows[0] as { n: number }).n).toBe(50);
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 60_000);

  test("concurrentIndexes leaves a partitioned parent index non-concurrent (PG rejects CONCURRENTLY there)", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("exec_cic_part_src");
    const desired = await cluster.createDb("exec_cic_part_dst");
    try {
      const seed = `
        CREATE SCHEMA app;
        CREATE TABLE app.p (id integer, ts date) PARTITION BY RANGE (ts);
        CREATE TABLE app.p_2024 PARTITION OF app.p
          FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
        INSERT INTO app.p
          SELECT i, DATE '2024-01-01' + i FROM generate_series(1, 50) i;
      `;
      await source.pool.query(seed);
      await desired.pool.query(`${seed}
        CREATE INDEX p_ts_idx ON app.p (ts);
      `);
      const [sourceState, desiredState] = [
        await extract(source.pool),
        await extract(desired.pool),
      ];
      const thePlan = plan(sourceState.factBase, desiredState.factBase, {
        params: { concurrentIndexes: true },
      });
      // PostgreSQL rejects CREATE INDEX CONCURRENTLY on a partitioned table's
      // parent index (relkind='p'), so that create must stay plain.
      const parentIndexAction = thePlan.actions.find((a) =>
        a.sql.includes("p_ts_idx"),
      );
      expect(parentIndexAction?.sql).not.toContain("CONCURRENTLY");
      const report = await apply(thePlan, source.pool, {
        fingerprintGate: false,
      });
      expect(report.status).toBe("applied");
      // converges to the same fact base as the direct CREATE INDEX
      const proven = await extract(source.pool);
      expect(proven.factBase.rootHash).toBe(desiredState.factBase.rootHash);
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 60_000);

  test("a trigger def change plans CREATE OR REPLACE TRIGGER, except a statement-level trigger on a partitioned parent", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("exec_trg_src");
    const desired = await cluster.createDb("exec_trg_dst");
    try {
      const schema = (events: string, level: string) => `
        CREATE FUNCTION public.audit() RETURNS trigger LANGUAGE plpgsql
          AS $$ BEGIN RETURN NEW; END; $$;
        CREATE TABLE public.t (id integer);
        CREATE TRIGGER t_trg BEFORE ${events} ON public.t
          FOR EACH ROW EXECUTE FUNCTION public.audit();
        CREATE TABLE public.p (id integer NOT NULL) PARTITION BY RANGE (id);
        CREATE TABLE public.p1 PARTITION OF public.p FOR VALUES FROM (0) TO (100);
        CREATE TRIGGER p_trg AFTER INSERT ON public.p
          FOR EACH ${level} EXECUTE FUNCTION public.audit();
      `;
      await source.pool.query(schema("INSERT", "ROW"));
      await desired.pool.query(schema("INSERT OR UPDATE", "STATEMENT"));
      await desired.pool.query(`ALTER TABLE public.t DISABLE TRIGGER t_trg`);
      const [sourceState, desiredState] = [
        await extract(source.pool),
        await extract(desired.pool),
      ];
      const thePlan = plan(sourceState.factBase, desiredState.factBase);
      const sqlFor = (trigger: string) =>
        thePlan.actions.map((a) => a.sql).filter((s) => s.includes(trigger));
      expect(sqlFor("t_trg")).toMatchInlineSnapshot(`
        [
          "CREATE OR REPLACE TRIGGER t_trg BEFORE INSERT OR UPDATE ON public.t FOR EACH ROW EXECUTE FUNCTION public.audit()",
          "ALTER TABLE "public"."t" DISABLE TRIGGER "t_trg"",
        ]
      `);
      // CREATE OR REPLACE updates only the parent, so the row-level clone on
      // p1 would stay and keep firing: a level flip there must drop+create.
      expect(sqlFor("p_trg")).toMatchInlineSnapshot(`
        [
          "DROP TRIGGER "p_trg" ON "public"."p"",
          "CREATE TRIGGER p_trg AFTER INSERT ON public.p FOR EACH STATEMENT EXECUTE FUNCTION public.audit()",
        ]
      `);
      // A snapshot stored before the marker existed loads without it (`_`
      // keys stay out of the digest), so both triggers fall back to
      // drop + create.
      const doc = JSON.parse(
        serializeSnapshot(desiredState.factBase, { pgVersion: "17" }),
      );
      for (const f of doc.facts) delete f.payload._statementOnPartitioned;
      const legacy = deserializeSnapshot(JSON.stringify(doc)).factBase;
      const legacySql = plan(sourceState.factBase, legacy).actions.map(
        (a) => a.sql,
      );
      expect(legacySql.filter((s) => s.includes("p_trg")))
        .toMatchInlineSnapshot(`
        [
          "DROP TRIGGER "p_trg" ON "public"."p"",
          "CREATE TRIGGER p_trg AFTER INSERT ON public.p FOR EACH STATEMENT EXECUTE FUNCTION public.audit()",
        ]
      `);
      expect(legacySql.filter((s) => s.includes("t_trg")))
        .toMatchInlineSnapshot(`
        [
          "DROP TRIGGER "t_trg" ON "public"."t"",
          "CREATE TRIGGER t_trg BEFORE INSERT OR UPDATE ON public.t FOR EACH ROW EXECUTE FUNCTION public.audit()",
          "ALTER TABLE "public"."t" DISABLE TRIGGER "t_trg"",
        ]
      `);
      const report = await apply(thePlan, source.pool, {
        fingerprintGate: false,
      });
      expect(report.status).toBe("applied");
      // extraction skips partition clones, so read pg_trigger directly
      const clones = await source.pool.query(
        `SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.p1'::regclass AND tgname = 'p_trg'`,
      );
      expect(clones.rows).toEqual([]);
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 60_000);

  test("unknown serialize parameters are a plan-time error", async () => {
    const cluster = await sharedCluster();
    const db = await cluster.createDb("exec_param");
    try {
      const state = await extract(db.pool);
      expect(() =>
        plan(state.factBase, state.factBase, { params: { typo: true } }),
      ).toThrow(/unknown serialize parameter 'typo'/);
    } finally {
      await db.drop();
    }
  }, 60_000);

  test("render-from-fact-base materialization: extract -> plan from scratch -> hash-identical", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("exec_mat_src");
    const scratch = await cluster.createDb("exec_mat_scratch");
    try {
      await source.pool.query(`
        CREATE SCHEMA app;
        CREATE TYPE app.level AS ENUM ('low', 'high');
        CREATE TABLE app.t (
          id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          lvl app.level DEFAULT 'low',
          note text
        );
        CREATE INDEX t_note_idx ON app.t (note);
        CREATE VIEW app.v AS SELECT id, lvl FROM app.t;
        COMMENT ON TABLE app.t IS 'materialization target';
      `);
      const sourceState = await extract(source.pool);
      // the §3.7 second materialization form: re-create the MODEL of the
      // source on an empty scratch (template cloning unavailable on live
      // sources). "Empty" includes the platform defaults the scratch
      // already carries, so the plan starts from the scratch's own state.
      const scratchState = await extract(scratch.pool);
      const thePlan = plan(scratchState.factBase, sourceState.factBase);
      const report = await apply(thePlan, scratch.pool, {
        fingerprintGate: false,
      });
      expect(report.status).toBe("applied");
      const materialized = await extract(scratch.pool);
      expect(materialized.factBase.rootHash).toBe(
        sourceState.factBase.rootHash,
      );
    } finally {
      await Promise.all([source.drop(), scratch.drop()]);
    }
  }, 60_000);
});
