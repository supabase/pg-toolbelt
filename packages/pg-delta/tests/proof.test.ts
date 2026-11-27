/**
 * Proof-harness safety checks (stage 3 / §3.7): the proof loop turns
 * declared safety metadata into verified claims. These tests inject a
 * mis-declaring action into a real plan and assert the proof catches it —
 * the safety net that protects every rule.
 */
import { describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import {
  computePlanId,
  plan,
  type Plan,
  type ProjectionAudit,
} from "../src/plan/plan.ts";
import { provePlan } from "../src/proof/prove.ts";
import type { Policy } from "../src/policy/policy.ts";
import { sharedCluster } from "./containers.ts";

function installSuspiciousAudit(thePlan: Plan): ProjectionAudit {
  const id = { kind: "schema" as const, name: "audit_hidden" };
  const audit: ProjectionAudit = {
    entries: [
      {
        delta: { verb: "add", fact: { id, payload: {} } },
        subject: { kind: "fact", id },
        suppressions: [
          {
            side: "desired",
            stage: "policyScopeRule",
            reasonCode: "policy:test:hidden",
            classification: "suspicious",
          },
        ],
        classification: "suspicious",
      },
    ],
    summary: { total: 1, suspicious: 1, acknowledged: 0, baseline: 0 },
  };
  thePlan.projectionAudit = audit;
  return audit;
}

function expectSuspiciousAuditOnEarlyReturn(
  verdict: Awaited<ReturnType<typeof provePlan>>,
  audit: ProjectionAudit,
): void {
  expect(verdict.projectionAuditStatus).toBe("available");
  expect(verdict.projectionAudit).toEqual(audit);
  expect(verdict.strictAuditFailure).toBe("suspicious");
}

describe("proof: rewrite observation", () => {
  test("an undeclared in-place rewrite (relfilenode change) fails the proof", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("proof_rw_src");
    const desired = await cluster.createDb("proof_rw_dst");
    try {
      await source.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id integer, n text);
        INSERT INTO app.t SELECT i, i::text FROM generate_series(1, 5) i;
      `);
      // a column TYPE change rewrites the table; the rule correctly declares
      // rewriteRisk:true, so a correct plan PASSES
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id bigint, n text);
      `);
      const [s, d] = [await extract(source.pool), await extract(desired.pool)];
      const honest = plan(s.factBase, d.factBase);
      const typeAction = honest.actions.find((a) =>
        a.sql.includes("TYPE bigint"),
      );
      expect(typeAction?.rewriteRisk).toBe(true);

      // simulate a BUGGY rule: strip the rewriteRisk declaration. The proof
      // must now catch the relfilenode change that nobody warned about.
      const buggy = structuredClone(honest);
      for (const a of buggy.actions) a.rewriteRisk = false;
      buggy.planId = computePlanId(buggy); // re-stamp the lie past apply's planId gate
      const verdict = await provePlan(buggy, source.pool, d.factBase);
      expect(verdict.rewriteViolations.length).toBeGreaterThan(0);
      // `.table` is structured { schema, name } — unambiguous (identifiers can
      // contain dots) and rendered with render.ts `rel()` for display.
      expect(verdict.rewriteViolations[0]?.table).toEqual({
        schema: "app",
        name: "t",
      });
      expect(verdict.ok).toBe(false);
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 60_000);

  test("a declared rewrite (rewriteRisk:true) is NOT a violation", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("proof_rw_ok_src");
    const desired = await cluster.createDb("proof_rw_ok_dst");
    try {
      await source.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id integer);
        INSERT INTO app.t SELECT generate_series(1, 5);
      `);
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id bigint);
      `);
      const [s, d] = [await extract(source.pool), await extract(desired.pool)];
      const verdict = await provePlan(
        plan(s.factBase, d.factBase),
        source.pool,
        d.factBase,
      );
      // relfilenode changed, but the rule declared it — no violation, and
      // the rows survived the type cast
      expect(verdict.rewriteViolations).toHaveLength(0);
      expect(verdict.dataViolations).toHaveLength(0);
      expect(verdict.ok).toBe(true);
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 60_000);

  test("ADD COLUMN ... VIRTUAL (PG 18) declares no rewrite and none happens", async () => {
    const cluster = await sharedCluster();
    if ((await cluster.pgMajor()) < 18) return;
    const source = await cluster.createDb("proof_rw_virt_src");
    const desired = await cluster.createDb("proof_rw_virt_dst");
    try {
      await source.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id integer);
        INSERT INTO app.t SELECT generate_series(1, 5);
      `);
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (id integer, v integer GENERATED ALWAYS AS (id * 2) VIRTUAL);
      `);
      const [s, d] = [await extract(source.pool), await extract(desired.pool)];
      const thePlan = plan(s.factBase, d.factBase);
      expect(
        thePlan.actions.map(({ sql, rewriteRisk }) => ({ sql, rewriteRisk })),
      ).toMatchInlineSnapshot(`
        [
          {
            "rewriteRisk": false,
            "sql": "ALTER TABLE "app"."t" ADD COLUMN "v" integer GENERATED ALWAYS AS ((id * 2)) VIRTUAL",
          },
        ]
      `);
      // a VIRTUAL column is computed on read: the relfilenode check proves no rewrite
      const verdict = await provePlan(thePlan, source.pool, d.factBase);
      expect(verdict.rewriteViolations).toHaveLength(0);
      expect(verdict.ok).toBe(true);
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 60_000);

  test("ALTER COLUMN TYPE on a VIRTUAL column (PG 18) declares no rewrite and none happens", async () => {
    const cluster = await sharedCluster();
    if ((await cluster.pgMajor()) < 18) return;
    const source = await cluster.createDb("proof_rw_virt_type_src");
    const desired = await cluster.createDb("proof_rw_virt_type_dst");
    try {
      const ddl = (type: string) => `
        CREATE SCHEMA app;
        CREATE TABLE app.t (id integer, v ${type} GENERATED ALWAYS AS (id * 2) VIRTUAL);
      `;
      await source.pool.query(
        `${ddl("integer")} INSERT INTO app.t SELECT generate_series(1, 5);`,
      );
      await desired.pool.query(ddl("bigint"));
      const [s, d] = [await extract(source.pool), await extract(desired.pool)];
      const thePlan = plan(s.factBase, d.factBase);
      expect(
        thePlan.actions.map(({ sql, rewriteRisk }) => ({ sql, rewriteRisk })),
      ).toMatchInlineSnapshot(`
        [
          {
            "rewriteRisk": false,
            "sql": "ALTER TABLE "app"."t" ALTER COLUMN "v" TYPE bigint",
          },
        ]
      `);
      // the stored value does not exist: the relfilenode check proves no rewrite
      const verdict = await provePlan(thePlan, source.pool, d.factBase);
      expect(verdict.rewriteViolations).toHaveLength(0);
      expect(verdict.ok).toBe(true);
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 60_000);
});

// Not corpus scenarios: a redeclared inherited column does not create from
// empty yet (docs/roadmap/pg-delta-next-follow-ups.md, "Redeclared inherited columns").
describe("plan: inherited column order", () => {
  // the child's CHECK calls a function that reads the parent's column
  const checked = `
    CREATE TABLE app.p (id integer, x integer);
    CREATE FUNCTION app.f(i integer) RETURNS boolean LANGUAGE sql
      BEGIN ATOMIC SELECT coalesce((SELECT max(x) FROM app.p), 0) >= 0 AND i IS NOT NULL; END;
    CREATE TABLE app.c (x integer, CHECK (app.f(id))) INHERITS (app.p);`;
  const cases = {
    "a parent and its redeclaring child both drop the column": {
      source: `
        CREATE TABLE app.z_parent (id integer, x integer);
        CREATE TABLE app.a_child (x integer) INHERITS (app.z_parent);`,
      desired: `
        CREATE TABLE app.z_parent (id integer);
        CREATE TABLE app.a_child () INHERITS (app.z_parent);`,
    },
    // the child dropped outright: tests/inheritance-redeclared-drop.test.ts
    // detaching the child replaces its table
    "the redeclaring child is detached while the parent drops the column": {
      source: checked,
      desired: `
        CREATE TABLE app.p (id integer);
        CREATE TABLE app.c (id integer, x integer);`,
    },
  };
  for (const [name, { source: from, desired: to }] of Object.entries(cases)) {
    test(`${name}: the plan converges`, async () => {
      const cluster = await sharedCluster();
      const source = await cluster.createDb("proof_inh_order_src");
      const desired = await cluster.createDb("proof_inh_order_dst");
      try {
        await source.pool.query(`CREATE SCHEMA app; ${from}`);
        await desired.pool.query(`CREATE SCHEMA app; ${to}`);
        const [s, d] = [
          await extract(source.pool),
          await extract(desired.pool),
        ];
        const verdict = await provePlan(
          plan(s.factBase, d.factBase),
          source.pool,
          d.factBase,
        );
        expect(verdict.applyError).toBeUndefined();
        expect(verdict.ok).toBe(true);
      } finally {
        await Promise.all([source.drop(), desired.drop()]);
      }
    }, 60_000);
  }
});

describe("plan: generated column kind change", () => {
  // Not a corpus scenario: export cannot round-trip a redeclared inherited
  // column yet (docs/roadmap/pg-delta-next-follow-ups.md, "Redeclared inherited columns").
  for (const [from, to] of [
    ["STORED", "VIRTUAL"],
    ["VIRTUAL", "STORED"],
  ] as const) {
    test(`${from} to ${to} (PG 18) converges when an INHERITS child redeclares the column`, async () => {
      const cluster = await sharedCluster();
      if ((await cluster.pgMajor()) < 18) return;
      const source = await cluster.createDb("proof_virt_inh_src");
      const desired = await cluster.createDb("proof_virt_inh_dst");
      try {
        // both name orders, since the tie-break is by table name
        const pair = (parent: string, child: string, kind: string) => `
          CREATE TABLE app.${parent} (n integer, v integer GENERATED ALWAYS AS (n * 2) ${kind});
          CREATE TABLE app.${child} (v integer GENERATED ALWAYS AS (n * 3) ${kind})
            INHERITS (app.${parent});`;
        // g_mid inherits the column without redeclaring it
        const ddl = (kind: string) => `
          CREATE SCHEMA app;
          ${pair("z_parent", "a_child", kind)}
          ${pair("a_parent", "z_child", kind)}
          CREATE TABLE app.g_root (n integer, v integer GENERATED ALWAYS AS (n * 2) ${kind});
          CREATE TABLE app.g_mid () INHERITS (app.g_root);
          CREATE TABLE app.a_grand (v integer GENERATED ALWAYS AS (n * 3) ${kind})
            INHERITS (app.g_mid);`;
        const lone = (parent: string, kind: string) =>
          `CREATE TABLE app.${parent} (n integer, v integer GENERATED ALWAYS AS (n * 2) ${kind});`;
        // d_child's CHECK calls a function that reads d_parent.v
        await source.pool.query(`${ddl(from)}
          ${lone("b_parent", from)}
          ${pair("d_parent", "d_child", from)}
          CREATE FUNCTION app.f(i integer) RETURNS boolean LANGUAGE sql
            BEGIN ATOMIC SELECT coalesce((SELECT max(v) FROM app.d_parent), 0) >= 0 AND i IS NOT NULL; END;
          ALTER TABLE app.d_child ADD CHECK (app.f(n));`);
        // b_parent's child is new in this plan, d_parent's is dropped
        await desired.pool.query(
          `${ddl(to)} ${pair("b_parent", "y_child", to)} ${lone("d_parent", to)}`,
        );
        const [s, d] = [
          await extract(source.pool),
          await extract(desired.pool),
        ];
        const verdict = await provePlan(
          plan(s.factBase, d.factBase),
          source.pool,
          d.factBase,
        );
        expect(verdict.applyError).toBeUndefined();
        expect(verdict.ok).toBe(true);
      } finally {
        await Promise.all([source.drop(), desired.drop()]);
      }
    }, 60_000);
  }

  // replacing the parent's column would reset the child's expression to the
  // parent's, and the override is not a fact, so no proof could see it
  const partition = (kind: string, own: string) => `
    CREATE TABLE app.p (a integer, v integer GENERATED ALWAYS AS (a * 2) ${kind})
      PARTITION BY RANGE (a);
    CREATE TABLE app.p1 PARTITION OF app.p ${own} FOR VALUES FROM (0) TO (100);`;
  const own = (kind: string) =>
    `(v WITH OPTIONS GENERATED ALWAYS AS (a * 3) ${kind})`;
  const overrides = {
    partition: (kind: string) => partition(kind, own(kind)),
    // the desired side may come from an export, which drops the override
    "partition on the source only": (kind: string) =>
      partition(kind, kind === "STORED" ? own(kind) : ""),
    // under a middle table that keeps the parent's expression
    "INHERITS grandchild": (kind: string) => `
      CREATE TABLE app.p (a integer, v integer GENERATED ALWAYS AS (a * 2) ${kind});
      CREATE TABLE app.p1 () INHERITS (app.p);
      CREATE TABLE app.p2 () INHERITS (app.p1);
      ALTER TABLE app.p2 ALTER COLUMN v SET EXPRESSION AS (a * 3);`,
  };
  for (const [shape, ddl] of Object.entries(overrides)) {
    test(`STORED to VIRTUAL (PG 18) is refused when a ${shape} has its own expression`, async () => {
      const cluster = await sharedCluster();
      if ((await cluster.pgMajor()) < 18) return;
      const source = await cluster.createDb("proof_virt_override_src");
      const desired = await cluster.createDb("proof_virt_override_dst");
      try {
        await source.pool.query(`CREATE SCHEMA app; ${ddl("STORED")}`);
        await desired.pool.query(`CREATE SCHEMA app; ${ddl("VIRTUAL")}`);
        const [s, d] = [
          await extract(source.pool),
          await extract(desired.pool),
        ];
        expect(() =>
          plan(s.factBase, d.factBase),
        ).toThrowErrorMatchingInlineSnapshot(
          `"plan: column "app"."p"."v" cannot change its generation kind: a child table overrides its generation expression, and replacing the column would reset it. Change the kind manually, then re-run."`,
        );
      } finally {
        await Promise.all([source.drop(), desired.drop()]);
      }
    }, 60_000);
  }
});

describe("proof: auto-seed data preservation", () => {
  test("auto-seed makes an undeclared row loss on a kept table visible", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("proof_seed_src");
    const desired = await cluster.createDb("proof_seed_dst");
    try {
      // identical schema both sides: a correct plan is empty. We inject a
      // TRUNCATE action with no `destroys` (so the table is "kept"), modeling
      // a rule that silently discards rows — auto-seed must surface it.
      const ddl = `CREATE SCHEMA app; CREATE TABLE app.t (id integer DEFAULT 1);`;
      await source.pool.query(ddl);
      await desired.pool.query(ddl);
      const [s, d] = [await extract(source.pool), await extract(desired.pool)];
      const thePlan = plan(s.factBase, d.factBase);
      thePlan.actions.push({
        sql: `TRUNCATE app.t`,
        subject: { kind: "table", schema: "app", name: "t" },
        verb: "alter",
        change: { kind: "attribute", name: "unspecified" },
        produces: [],
        consumes: [{ kind: "table", schema: "app", name: "t" }],
        destroys: [],
        releases: [],
        transactionality: "transactional",
        lockClass: "accessExclusive",
        newSegmentBefore: false,
        dataLoss: "none", // the lie the proof must catch
        rewriteRisk: false,
      });
      thePlan.planId = computePlanId(thePlan); // re-stamp the lie past apply's planId gate
      // without auto-seed the kept table is empty, so the loss is invisible
      const blind = await provePlan(
        structuredClone(thePlan),
        source.pool,
        d.factBase,
        {
          autoSeed: false,
        },
      );
      expect(blind.dataViolations).toHaveLength(0);
      // re-clone-equivalent: fresh dbs so the first run's TRUNCATE doesn't taint
      const source2 = await cluster.createDb("proof_seed_src2");
      try {
        await source2.pool.query(ddl);
        const s2 = await extract(source2.pool);
        const thePlan2 = plan(s2.factBase, d.factBase);
        thePlan2.actions.push({
          sql: `TRUNCATE app.t`,
          subject: { kind: "table", schema: "app", name: "t" },
          verb: "alter",
          change: { kind: "attribute", name: "unspecified" },
          produces: [],
          consumes: [{ kind: "table", schema: "app", name: "t" }],
          destroys: [],
          releases: [],
          transactionality: "transactional",
          lockClass: "accessExclusive",
          newSegmentBefore: false,
          dataLoss: "none",
          rewriteRisk: false,
        });
        thePlan2.planId = computePlanId(thePlan2); // re-stamp the lie past apply's planId gate
        const seeded = await provePlan(thePlan2, source2.pool, d.factBase, {
          autoSeed: true,
        });
        expect(seeded.dataViolations.length).toBeGreaterThan(0);
        // `.table` is structured { schema, name }.
        expect(seeded.dataViolations[0]?.table).toEqual({
          schema: "app",
          name: "t",
        });
      } finally {
        await source2.drop();
      }
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 60_000);
});

describe("proof: projection audit on early returns", () => {
  test("seed data side-effect return retains audit status, data, and strict failure", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("proof_audit_seed_data");
    try {
      await source.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.victim (id integer);
        INSERT INTO app.victim VALUES (1);
        CREATE TABLE app.seed_mutator (id integer);
        CREATE FUNCTION app.delete_victim() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN DELETE FROM app.victim; RETURN NEW; END $$;
        CREATE TRIGGER delete_victim_after AFTER INSERT ON app.seed_mutator
          FOR EACH ROW EXECUTE FUNCTION app.delete_victim();
      `);
      const { factBase } = await extract(source.pool);
      const thePlan = plan(factBase, factBase);
      const audit = installSuspiciousAudit(thePlan);

      const verdict = await provePlan(thePlan, source.pool, factBase, {
        autoSeed: true,
        strictAudit: true,
      });

      expect(verdict.seedSideEffects).toContainEqual({
        table: { schema: "app", name: "victim" },
        before: 1,
        after: 0,
      });
      expectSuspiciousAuditOnEarlyReturn(verdict, audit);
    } finally {
      await source.drop();
    }
  }, 60_000);

  test("seed state-change return retains audit status, data, and strict failure", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("proof_audit_seed_state");
    try {
      await source.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.victim (id integer);
        INSERT INTO app.victim VALUES (1);
        CREATE TABLE app.seed_mutator (id integer);
        CREATE FUNCTION app.enable_victim_rls() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            ALTER TABLE app.victim ENABLE ROW LEVEL SECURITY;
            RETURN NEW;
          END $$;
        CREATE TRIGGER enable_victim_rls_after AFTER INSERT ON app.seed_mutator
          FOR EACH ROW EXECUTE FUNCTION app.enable_victim_rls();
      `);
      const { factBase } = await extract(source.pool);
      const thePlan = plan(factBase, factBase);
      const audit = installSuspiciousAudit(thePlan);

      const verdict = await provePlan(thePlan, source.pool, factBase, {
        autoSeed: true,
        strictAudit: true,
      });

      expect(verdict.seedStateViolation).toMatchObject({
        expectedFingerprint: factBase.rootHash,
        actualFingerprint: expect.any(String),
      });
      expectSuspiciousAuditOnEarlyReturn(verdict, audit);
    } finally {
      await source.drop();
    }
  }, 60_000);

  test("apply-failure return retains audit status, data, and strict failure", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("proof_audit_apply_failure");
    try {
      await source.pool.query(
        `CREATE SCHEMA app; CREATE TABLE app.t (id integer)`,
      );
      const { factBase } = await extract(source.pool);
      const thePlan = plan(factBase, factBase);
      thePlan.actions.push({
        sql: "SELECT * FROM app.definitely_missing",
        subject: { kind: "schema", name: "app" },
        verb: "alter",
        change: { kind: "attribute", name: "unspecified" },
        produces: [],
        consumes: [],
        destroys: [],
        releases: [],
        transactionality: "transactional",
        lockClass: "none",
        newSegmentBefore: false,
        dataLoss: "none",
        rewriteRisk: false,
      });
      thePlan.planId = computePlanId(thePlan); // re-stamp the injection past apply's planId gate
      const audit = installSuspiciousAudit(thePlan);

      const verdict = await provePlan(thePlan, source.pool, factBase, {
        strictAudit: true,
      });

      expect(verdict.applyError).toMatchObject({ actionIndex: 0 });
      expectSuspiciousAuditOnEarlyReturn(verdict, audit);
    } finally {
      await source.drop();
    }
  }, 60_000);
});

describe("proof: projection audit", () => {
  test("surfaces suspicious managed-view suppression and optionally blocks it", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("proof_audit_src");
    const desired = await cluster.createDb("proof_audit_dst");
    try {
      await source.pool.query(`CREATE SCHEMA app`);
      await desired.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.ignored ();
      `);
      const [s, d] = [await extract(source.pool), await extract(desired.pool)];
      const policy: Policy = {
        id: "generic",
        filter: [{ match: { kind: "table" }, action: "exclude" }],
      };
      const thePlan = plan(s.factBase, d.factBase, { policy });
      expect(thePlan.projectionAudit).toBeDefined();

      const informational = await provePlan(
        structuredClone(thePlan),
        source.pool,
        d.factBase,
      );
      expect(informational.ok).toBe(true);
      expect(informational.projectionAuditStatus).toBe("available");
      expect(informational.projectionAudit).toEqual(thePlan.projectionAudit!);
      expect(informational.projectionAudit.summary.suspicious).toBeGreaterThan(
        0,
      );
      expect(informational.projectionAudit.entries).toContainEqual(
        expect.objectContaining({
          delta: expect.objectContaining({
            verb: "add",
            fact: expect.objectContaining({
              id: { kind: "table", schema: "app", name: "ignored" },
            }),
          }),
          classification: "suspicious",
        }),
      );

      const strict = await provePlan(thePlan, source.pool, d.factBase, {
        strictAudit: true,
      });
      expect(strict.ok).toBe(false);
      expect(strict.strictAuditFailure).toBe("suspicious");
      expect(strict.driftDeltas).toHaveLength(0);
      expect(strict.dataViolations).toHaveLength(0);
      expect(strict.rewriteViolations).toHaveLength(0);

      const acknowledgedPlan = structuredClone(thePlan);
      const auditTotal = acknowledgedPlan.projectionAudit!.summary.total;
      acknowledgedPlan.projectionAudit = {
        entries: acknowledgedPlan.projectionAudit!.entries.map((entry) => ({
          ...entry,
          classification: "acknowledged",
          suppressions: entry.suppressions.map((suppression) => ({
            ...suppression,
            classification: "acknowledged",
          })),
        })),
        summary: {
          total: auditTotal,
          suspicious: 0,
          acknowledged: auditTotal,
          baseline: auditTotal,
        },
      };
      const acknowledged = await provePlan(
        acknowledgedPlan,
        source.pool,
        d.factBase,
        { strictAudit: true },
      );
      expect(acknowledged.ok).toBe(true);
      expect(acknowledged.projectionAudit.summary).toMatchObject({
        suspicious: 0,
        acknowledged: auditTotal,
        baseline: 0,
      });

      const inconsistentPlan = structuredClone(thePlan);
      inconsistentPlan.projectionAudit!.summary = {
        total: 0,
        suspicious: 0,
        acknowledged: 0,
        baseline: 0,
      };
      const inconsistent = await provePlan(
        inconsistentPlan,
        source.pool,
        d.factBase,
        { strictAudit: true },
      );
      expect(inconsistent.ok).toBe(false);
      expect(inconsistent.strictAuditFailure).toBe("suspicious");
      expect(inconsistent.projectionAudit.summary.suspicious).toBeGreaterThan(
        0,
      );

      const legacyPlan = structuredClone(thePlan);
      delete legacyPlan.projectionAudit;
      const legacy = await provePlan(legacyPlan, source.pool, d.factBase, {
        strictAudit: true,
      });
      expect(legacy.ok).toBe(false);
      expect(legacy.projectionAuditStatus).toBe("unavailable");
      expect(legacy.strictAuditFailure).toBe("unavailable");
      expect(legacy.projectionAudit).toEqual({
        entries: [],
        summary: { total: 0, suspicious: 0, acknowledged: 0, baseline: 0 },
      });
    } finally {
      await Promise.all([source.drop(), desired.drop()]);
    }
  }, 60_000);
});
