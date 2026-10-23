/**
 * Public schema frontend API: buildSchemaExport / planSchemaFiles /
 * provisionCoLocatedShadow. Integration (Postgres via testcontainers).
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { apply } from "../src/apply/apply.ts";
import { encodeId } from "../src/core/stable-id.ts";
import { extract } from "../src/extract/extract.ts";
import {
  buildSchemaExport,
  exportSqlFiles,
  loadSqlFiles,
  planSchemaFiles,
  provisionCoLocatedShadow,
  readExportManifest,
  renderPlanFiles,
  saveSnapshot,
  ShadowProvisionError,
  writeExportManifest,
  type ManagementScope,
  type PlanSchemaFilesOptions,
  type PlanSchemaFilesResult,
  type SqlFile,
} from "../src/frontends/index.ts";
import {
  rawProfile,
  type IntegrationProfile,
} from "../src/integrations/index.ts";
import { settleDesired } from "../src/frontends/settle-desired.ts";
import type { Policy } from "../src/policy/policy.ts";
import { reconstructManagedView } from "../src/policy/reconstruct.ts";
import { isolatedClusterPair, sharedCluster } from "./containers.ts";

const SCHEMA_SQL = `
  CREATE SCHEMA app;
  CREATE TABLE app.items (id integer PRIMARY KEY, name text NOT NULL);
`;

/** A pool on `uri` logged in as `role`, whose password is its name. */
function loginPool(uri: string, role: string): pg.Pool {
  const url = new URL(uri);
  url.username = role;
  url.password = role;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 5 });
  pool.on("error", () => {});
  return pool;
}

/** Plan `files` against a fresh target built from `targetSql`, read as
 *  `applier` when given. */
async function planAgainst(
  name: string,
  targetSql: string,
  files: string,
  {
    renames = "auto",
    profile = rawProfile,
    applier,
    acceptRenames,
  }: {
    renames?: "auto" | "prompt" | "off";
    profile?: IntegrationProfile;
    applier?: string;
    acceptRenames?: PlanSchemaFilesOptions["acceptRenames"];
  } = {},
): Promise<PlanSchemaFilesResult> {
  const cluster = await sharedCluster();
  const target = await cluster.createDb(`${name}_target`);
  const shadow = await cluster.createDb(`${name}_shadow`);
  const pool =
    applier === undefined ? target.pool : loginPool(target.uri, applier);
  try {
    await target.pool.query(targetSql);
    return await planSchemaFiles(
      pool,
      shadow.pool,
      [{ name: "t.sql", sql: files }],
      {
        profile,
        scope: "database",
        renames,
        ...(acceptRenames === undefined ? {} : { acceptRenames }),
      },
    );
  } finally {
    if (pool !== target.pool) await pool.end();
    await Promise.all([target.drop(), shadow.drop()]);
  }
}

/** Run with a NOLOGIN owner and a non-superuser LOGIN applier, dropped after. */
async function withOwnerAndApplier(
  tag: string,
  run: (owner: string, applier: string) => Promise<void>,
): Promise<void> {
  const { adminPool } = await sharedCluster();
  const suffix = Date.now().toString(36);
  const owner = `${tag}_owner_${suffix}`;
  const applier = `${tag}_app_${suffix}`;
  try {
    await adminPool.query(`
      CREATE ROLE "${owner}" NOLOGIN;
      CREATE ROLE "${applier}" LOGIN NOSUPERUSER PASSWORD '${applier}';
    `);
    await run(owner, applier);
  } finally {
    await adminPool.query(
      `DROP ROLE IF EXISTS "${owner}"; DROP ROLE IF EXISTS "${applier}"`,
    );
  }
}

const sqlOf = (planned: PlanSchemaFilesResult): string[] =>
  planned.plan.actions.map((a) => a.sql);

describe("public schema frontends", () => {
  test("buildSchemaExport reproduces CLI export files + manifest (raw, database scope)", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("frontend_export_src");
    try {
      await source.pool.query(SCHEMA_SQL);
      const result = await buildSchemaExport(source.pool, {
        profile: rawProfile,
        scope: "database",
        layout: "by-object",
        format: { keywordCase: "lower", maxWidth: 180 },
      });

      expect(result.files.length).toBeGreaterThan(0);
      expect(result.files.some((f) => f.name.includes("items"))).toBe(true);
      expect(result.files.some((f) => f.name.includes("cluster/roles"))).toBe(
        false,
      );
      expect(result.manifest).toMatchObject({
        redactSecrets: true,
        scope: "database" satisfies ManagementScope,
        profile: "raw",
      });
      expect("defaultOwner" in result.manifest).toBe(true);
    } finally {
      await source.drop();
    }
  }, 90_000);

  test("buildSchemaExport cluster scope retains roles/memberships", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("frontend_export_cl");
    try {
      await source.pool.query(SCHEMA_SQL);
      const result = await buildSchemaExport(source.pool, {
        profile: rawProfile,
        scope: "cluster",
        layout: "by-object",
        format: { keywordCase: "lower", maxWidth: 180 },
      });

      expect(result.files.some((f) => f.name.includes("cluster/roles"))).toBe(
        true,
      );
      expect(result.manifest.scope).toBe("cluster");
      expect("defaultOwner" in result.manifest).toBe(false);
    } finally {
      await source.drop();
    }
  }, 90_000);

  test("database-scope planSchemaFiles rejects cluster DDL before loading shadow", async () => {
    const cluster = await sharedCluster();
    const target = await cluster.createDb("frontend_rej");
    try {
      const files: SqlFile[] = [
        { name: "roles.sql", sql: "CREATE ROLE frontend_probe nologin;\n" },
        { name: "t.sql", sql: "CREATE TABLE public.t (id int);\n" },
      ];
      expect(
        planSchemaFiles(target.pool, target.pool, files, {
          profile: rawProfile,
          scope: "database",
        }),
      ).rejects.toThrow(/cluster DDL/);
    } finally {
      await target.drop();
    }
  }, 90_000);

  test("planSchemaFiles rejects the target database reused as its shadow before loading SQL", async () => {
    const cluster = await sharedCluster();
    const target = await cluster.createDb("frontend_same_shadow");
    try {
      const files: SqlFile[] = [
        {
          name: "schema.sql",
          sql: "CREATE SCHEMA must_not_reach_target;\n",
        },
      ];
      expect(
        planSchemaFiles(target.pool, target.pool, files, {
          profile: rawProfile,
          scope: "database",
        }),
      ).rejects.toThrow(/same observed database/i);
      expect(
        await target.pool.query(
          `SELECT to_regnamespace('must_not_reach_target') IS NULL AS absent`,
        ),
      ).toMatchObject({ rows: [{ absent: true }] });
    } finally {
      await target.drop();
    }
  }, 90_000);

  test("planSchemaFiles rejects an isolated sibling from the target lineage before cluster DDL", async () => {
    const cluster = await sharedCluster();
    const target = await cluster.createDb("frontend_lineage_target");
    const shadow = await cluster.createDb("frontend_lineage_shadow");
    const rolesBefore = await cluster.listRoles();
    const role = `frontend_lineage_role_${Date.now().toString(36)}`;
    try {
      const files: SqlFile[] = [
        { name: "role.sql", sql: `CREATE ROLE ${role};\n` },
      ];
      expect(
        planSchemaFiles(target.pool, shadow.pool, files, {
          profile: rawProfile,
          scope: "cluster",
          isolatedShadow: true,
        }),
      ).rejects.toThrow(/different PostgreSQL lineage/i);
      expect(
        await target.pool.query(
          `SELECT count(*)::int AS n FROM pg_roles WHERE rolname = $1`,
          [role],
        ),
      ).toMatchObject({ rows: [{ n: 0 }] });
    } finally {
      await Promise.all([target.drop(), shadow.drop()]);
      await cluster.dropRolesExcept(rolesBefore, { strict: true });
    }
  }, 90_000);

  test("planSchemaFiles tolerates a pre-provisioned isolated shadow (Supabase CLI seam)", async () => {
    // End-to-end shape of the Supabase CLI's declarative flow: the isolated
    // shadow is pre-provisioned with the platform baseline (schemas + the
    // services' own migration rows) BEFORE declarative SQL is loaded. The
    // baseline exists on the target too, so with identical schema intent on both
    // sides the plan must be EMPTY — the pre-existing rows must neither fail the
    // load nor leak into the diff.
    const [clusterA, clusterB] = await isolatedClusterPair();
    const target = await clusterA.createDb("frontend_preseeded_target");
    const shadow = await clusterB.createDb("frontend_preseeded_shadow");
    try {
      const BASELINE_DDL = `
        CREATE SCHEMA auth;
        CREATE TABLE auth.schema_migrations (version text PRIMARY KEY);
      `;
      await target.pool.query(BASELINE_DDL + SCHEMA_SQL);
      await shadow.pool.query(
        `${BASELINE_DDL} INSERT INTO auth.schema_migrations VALUES ('20240101000000');`,
      );

      // the declarative directory carries USER schema only; the baseline is
      // pre-provisioned on both sides (exactly how the CLI drives this).
      const files: SqlFile[] = [{ name: "app.sql", sql: SCHEMA_SQL }];
      const planned = await planSchemaFiles(target.pool, shadow.pool, files, {
        profile: rawProfile,
        scope: "database",
        isolatedShadow: true,
      });
      expect(planned.plan.actions).toEqual([]);
      expect(
        planned.loadDiagnostics.filter((d) => d.code === "data_statement"),
      ).toEqual([]);
    } finally {
      await Promise.all([target.drop(), shadow.drop()]);
    }
  }, 120_000);

  test("planSchemaFiles converges on a definition Postgres rewrites on replay (#510)", async () => {
    const cluster = await sharedCluster();
    const target = await cluster.createDb("frontend_settle_target");
    const shadows = [
      await cluster.createDb("frontend_settle_shadow1"),
      await cluster.createDb("frontend_settle_shadow2"),
    ];
    try {
      const files: SqlFile[] = [
        {
          name: "t.sql",
          sql: `
            CREATE SCHEMA app;
            CREATE TABLE app.tt (a int, b int, c int);
            CREATE FUNCTION app.tf() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$;
            CREATE TRIGGER t AFTER UPDATE ON app.tt FOR EACH ROW
              WHEN ((OLD.a, OLD.b, OLD.c) IS DISTINCT FROM (NEW.a, NEW.b, NEW.c))
              EXECUTE FUNCTION app.tf();
          `,
        },
      ];
      const options = { profile: rawProfile, scope: "database" as const };
      const first = await planSchemaFiles(
        target.pool,
        shadows[0]!.pool,
        files,
        options,
      );
      const report = await apply(first.plan, target.pool, first.applyOptions);
      expect(report.status).toBe("applied");

      const second = await planSchemaFiles(
        target.pool,
        shadows[1]!.pool,
        files,
        options,
      );
      expect(second.plan.actions.map((a) => a.sql)).toEqual([]);
      const rewritten = second.loadDiagnostics.filter(
        (d) => d.code === "deparse_rewritten",
      );
      expect(rewritten.map((d) => encodeId(d.subject!))).toEqual([
        "trigger:app.tt.t",
      ]);
      expect(rewritten[0]!.message).toContain(
        "WHEN (((old.a IS DISTINCT FROM new.a) OR (old.b IS DISTINCT FROM new.b) OR (old.c IS DISTINCT FROM new.c)))",
      );
    } finally {
      await Promise.all([target.drop(), ...shadows.map((s) => s.drop())]);
    }
  }, 120_000);

  test("planSchemaFiles quotes the stable spelling when the target is one replay ahead (#510)", async () => {
    // Nested rows expand one level per parse. After one sync the target holds
    // the second printout and the files load the first, so the files' first
    // replay already matches the target; the warning must still quote the
    // third, stable printout.
    const cluster = await sharedCluster();
    const target = await cluster.createDb("frontend_settle_n_target");
    const shadows = [
      await cluster.createDb("frontend_settle_n_shadow1"),
      await cluster.createDb("frontend_settle_n_shadow2"),
    ];
    try {
      const files: SqlFile[] = [
        {
          name: "t.sql",
          sql: `
            CREATE SCHEMA app;
            CREATE TABLE app.t (a int, b int, c int, d int, e int,
              CONSTRAINT ck CHECK (((a, b), (c, d), e) IS DISTINCT FROM ((1, 2), (3, 4), 5)));
          `,
        },
      ];
      const options = { profile: rawProfile, scope: "database" as const };
      const first = await planSchemaFiles(
        target.pool,
        shadows[0]!.pool,
        files,
        options,
      );
      const report = await apply(first.plan, target.pool, first.applyOptions);
      expect(report.status).toBe("applied");

      const second = await planSchemaFiles(
        target.pool,
        shadows[1]!.pool,
        files,
        options,
      );
      expect(second.plan.actions.map((a) => a.sql)).toEqual([]);
      const rewritten = second.loadDiagnostics.filter(
        (d) => d.code === "deparse_rewritten",
      );
      expect(rewritten.map((d) => encodeId(d.subject!))).toEqual([
        "constraint:app.t.ck",
      ]);
      expect(rewritten[0]!.message).toContain(
        "CHECK (((a IS DISTINCT FROM 1) OR (b IS DISTINCT FROM 2) OR ((c IS DISTINCT FROM 3) OR (d IS DISTINCT FROM 4)) OR (e IS DISTINCT FROM 5)))",
      );
    } finally {
      await Promise.all([target.drop(), ...shadows.map((s) => s.drop())]);
    }
  }, 120_000);

  test("planSchemaFiles replays a dependent against the desired definitions only (#510)", async () => {
    // base really changes type; dependent only differs by spelling, so it is
    // replayed while base is replayed on the target side. Rebuilt against base's
    // numeric target definition, dependent would pick up numeric casts.
    const cluster = await sharedCluster();
    const target = await cluster.createDb("frontend_settle_d_target");
    const shadows = [
      await cluster.createDb("frontend_settle_d_shadow1"),
      await cluster.createDb("frontend_settle_d_shadow2"),
    ];
    const views = (base: string): string => `
      CREATE SCHEMA app;
      CREATE VIEW app.base AS SELECT 1::${base} AS n;
      CREATE VIEW app.dependent AS
        SELECT n + 1 AS x FROM app.base WHERE n BETWEEN 0 AND 10 AND n >= 0;
    `;
    try {
      await target.pool.query(views("numeric"));
      const files: SqlFile[] = [{ name: "v.sql", sql: views("integer") }];
      const options = { profile: rawProfile, scope: "database" as const };
      const first = await planSchemaFiles(
        target.pool,
        shadows[0]!.pool,
        files,
        options,
      );
      const report = await apply(first.plan, target.pool, first.applyOptions);
      expect(report.status).toBe("applied");
      const { rows } = await target.pool.query(
        `SELECT format_type(atttypid, atttypmod) AS type FROM pg_attribute
         WHERE attrelid = 'app.dependent'::regclass AND attname = 'x'`,
      );
      expect(rows).toEqual([{ type: "integer" }]);

      const second = await planSchemaFiles(
        target.pool,
        shadows[1]!.pool,
        files,
        options,
      );
      expect(second.plan.actions.map((a) => a.sql)).toEqual([]);
    } finally {
      await Promise.all([target.drop(), ...shadows.map((s) => s.drop())]);
    }
  }, 120_000);

  test("planSchemaFiles rebuilds row filters on inherited columns around a type change (#510)", async () => {
    // An inherited column's dependencies resolve to the ancestor that defines
    // it (the root for a partition, possibly a non-first parent), so the row
    // filters below depend on parent.a, base.a and p2.a. Postgres refuses to
    // retype a column a publication WHERE clause uses, so every membership
    // must be rebuilt around the type change.
    const cluster = await sharedCluster();
    // row filters need PostgreSQL 15
    if ((await cluster.pgMajor()) < 15) return;
    const target = await cluster.createDb("frontend_settle_i_target");
    const shadows = [
      await cluster.createDb("frontend_settle_i_shadow1"),
      await cluster.createDb("frontend_settle_i_shadow2"),
    ];
    const schema = (type: string): string => `
      CREATE SCHEMA app;
      CREATE TABLE app.parent (id int, a ${type}) PARTITION BY RANGE (id);
      CREATE TABLE app.part1 PARTITION OF app.parent FOR VALUES FROM (0) TO (100);
      CREATE TABLE app.base (id int, a ${type});
      CREATE TABLE app.child () INHERITS (app.base);
      CREATE TABLE app.p1 (id int);
      CREATE TABLE app.p2 (a ${type});
      CREATE TABLE app.multi () INHERITS (app.p1, app.p2);
      CREATE PUBLICATION p FOR TABLE app.part1 WHERE (a > 0), TABLE app.child WHERE (a > 0),
        TABLE app.multi WHERE (a > 0) WITH (publish = 'insert');
    `;
    try {
      await target.pool.query(schema("integer"));
      const files: SqlFile[] = [{ name: "p.sql", sql: schema("numeric") }];
      const options = { profile: rawProfile, scope: "database" as const };
      const first = await planSchemaFiles(
        target.pool,
        shadows[0]!.pool,
        files,
        options,
      );
      const report = await apply(first.plan, target.pool, first.applyOptions);
      expect(report.status).toBe("applied");

      const second = await planSchemaFiles(
        target.pool,
        shadows[1]!.pool,
        files,
        options,
      );
      expect(second.plan.actions.map((a) => a.sql)).toEqual([]);
    } finally {
      await Promise.all([target.drop(), ...shadows.map((s) => s.drop())]);
    }
  }, 120_000);

  test("settleDesired survives a connection error event while it holds its client (#510)", async () => {
    // pg-pool drops its idle `error` listener on checkout, so a dropped
    // connection would crash the process unless the holder listens.
    const cluster = await sharedCluster();
    const target = await cluster.createDb("frontend_settle_e_target");
    const shadow = await cluster.createDb("frontend_settle_e_shadow");
    try {
      await target.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (a int, b int, CONSTRAINT t_check CHECK (b BETWEEN 0 AND 10 AND a >= 0));
      `);
      await shadow.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (a int, b int, CONSTRAINT t_check CHECK ((((b >= 0) AND (b <= 10)) AND (a >= 0))));
      `);
      const current = (await extract(target.pool)).factBase;
      const desired = (await extract(shadow.pool)).factBase;
      const emitting = {
        connect: (
          callback?: (
            error: Error | undefined,
            client: pg.PoolClient | undefined,
            release: (error?: Error | boolean) => void,
          ) => void,
        ) => {
          const emitSoon = (client: pg.PoolClient): void => {
            setTimeout(() => client.emit("error", new Error("dropped")), 0);
          };
          if (callback === undefined) {
            return shadow.pool.connect().then((client) => {
              emitSoon(client);
              return client;
            });
          }
          shadow.pool.connect((error, client, release) => {
            if (client !== undefined) emitSoon(client);
            callback(error, client, release);
          });
          return undefined;
        },
      } as unknown as pg.Pool;

      const settled = await settleDesired(emitting, current, desired);
      expect(
        settled.diagnostics.map((d) => [d.code, encodeId(d.subject!)]),
      ).toEqual([["deparse_target_unsettled", "constraint:app.t.t_check"]]);
    } finally {
      await Promise.all([target.drop(), shadow.drop()]);
    }
  }, 120_000);

  test("planSchemaFiles treats a target holding a less-replayed spelling as unchanged (#510)", async () => {
    // The target was built by a hand-written migration (Postgres keeps BETWEEN
    // nested under the outer AND); the files hold what `schema export` prints
    // for it, which loads flat. Same meaning, so nothing may be rebuilt.
    const cluster = await sharedCluster();
    const target = await cluster.createDb("frontend_settle_b_target");
    const shadow = await cluster.createDb("frontend_settle_b_shadow");
    try {
      await target.pool.query(`
        CREATE SCHEMA app;
        CREATE TABLE app.t (a int, b int, CONSTRAINT t_check CHECK (b BETWEEN 0 AND 10 AND a >= 0));
      `);
      const files: SqlFile[] = [
        {
          name: "t.sql",
          sql: `
            CREATE SCHEMA app;
            CREATE TABLE app.t (a int, b int, CONSTRAINT t_check CHECK ((((b >= 0) AND (b <= 10)) AND (a >= 0))));
          `,
        },
      ];
      const planned = await planSchemaFiles(target.pool, shadow.pool, files, {
        profile: rawProfile,
        scope: "database",
      });
      expect(planned.plan.actions.map((a) => a.sql)).toEqual([]);
      const settleDiagnostics = planned.loadDiagnostics
        .filter((d) => d.code.startsWith("deparse_"))
        .map((d) => [d.code, d.severity, encodeId(d.subject!)]);
      expect(settleDiagnostics).toEqual([
        ["deparse_target_unsettled", "info", "constraint:app.t.t_check"],
      ]);
    } finally {
      await Promise.all([target.drop(), shadow.drop()]);
    }
  }, 120_000);

  // Renamed-table settling the proof loop can prove lives in the
  // corpus/deparse-settle--rename-* scenarios; these need a prompt, a
  // restricted applier, a policy, or a new object the target never holds.
  const checked = (table: string, check: string): string => `
    CREATE TABLE s.${table} (a int, b int, CONSTRAINT ck CHECK (${check}));
  `;
  const flat = (upper: number): string =>
    `(b >= 0) AND (b <= ${upper}) AND (a >= 0)`;
  const between = (upper: number): string =>
    `b BETWEEN 0 AND ${upper} AND a >= 0`;
  const renamedT1 = `CREATE SCHEMA s; ${checked("t1", flat(10))}`;

  test("planSchemaFiles reports a settled rename in prompt mode, and a real change stays drop+create (#535)", async () => {
    const renamedT2 = `CREATE SCHEMA s; ${checked("t2", between(10))}`;
    const prompted = await planAgainst(
      "frontend_settle_p",
      renamedT1,
      renamedT2,
      { renames: "prompt" },
    );
    expect(
      prompted.plan.renameCandidates.map((c) => [
        encodeId(c.from),
        encodeId(c.to),
        c.status,
      ]),
    ).toEqual([["table:s.t1", "table:s.t2", "unambiguous"]]);
    // accepting the reported pair plans the rename
    const accepted = await planAgainst(
      "frontend_settle_pa",
      renamedT1,
      renamedT2,
      {
        renames: "prompt",
        acceptRenames: prompted.plan.renameCandidates,
      },
    );
    expect(sqlOf(accepted)).toMatchInlineSnapshot(`
      [
        "ALTER TABLE "s"."t1" RENAME TO "t2"",
      ]
    `);
    const changed = await planAgainst(
      "frontend_settle_c",
      renamedT1,
      `CREATE SCHEMA s; ${checked("t2", between(11))}`,
    );
    expect(sqlOf(changed)).toMatchInlineSnapshot(`
      [
        "DROP TABLE "s"."t1"",
        "CREATE TABLE "s"."t2" ("a" integer, "b" integer, CONSTRAINT "ck" CHECK (((b >= 0) AND (b <= 11) AND (a >= 0))))",
      ]
    `);
  }, 120_000);

  test("planSchemaFiles settles before refusing an owner the applier cannot set (#535)", async () => {
    // Replacing the table for its partition key would restore an owner the
    // applier cannot become; the key only differs in spelling.
    await withOwnerAndApplier("frontend_settle_o", async (owner, applier) => {
      const table = (key: string): string => `
        CREATE SCHEMA s;
        CREATE TABLE s.pt (a int, b int) PARTITION BY LIST ((${key}));
        ALTER TABLE s.pt OWNER TO "${owner}";
      `;
      const planned = await planAgainst(
        "frontend_settle_o",
        table(`(${flat(10)})`),
        table(between(10)),
        { applier, renames: "off" },
      );
      expect(sqlOf(planned)).toEqual([]);
      // a key that really changes is still refused, also when nothing settles
      // and the owner-widened first plan would otherwise be kept
      const refused = await planAgainst(
        "frontend_settle_o2",
        table(`(${flat(10)})`),
        table(`(${flat(11)})`),
        { applier, renames: "off" },
      ).catch((error: unknown) => error);
      expect(String(refused)).toMatch(/capability: cannot set owner/);
    });
  }, 120_000);

  test("planSchemaFiles keeps an exact rename over a near-miss counterpart (#535)", async () => {
    // s.kept matches the files exactly; s.other only after settling.
    const planned = await planAgainst(
      "frontend_settle_k",
      `CREATE SCHEMA s; ${checked("kept", between(10))} ${checked("other", flat(10))}`,
      `CREATE SCHEMA s; ${checked("renamed", between(10))}`,
    );
    expect(sqlOf(planned)).toMatchInlineSnapshot(`
      [
        "DROP TABLE "s"."other"",
        "ALTER TABLE "s"."kept" RENAME TO "renamed"",
      ]
    `);
  }, 120_000);

  test("planSchemaFiles never loses an exact rename to settling (#535)", async () => {
    // s.added settles equal to s.kept, which would make s.kept -> s.renamed
    // ambiguous; rebuilding s.renamed would need an owner the applier cannot
    // become, which must not be refused before the rename is restored.
    await withOwnerAndApplier("frontend_settle_eo", async (owner, applier) => {
      const owned = (table: string, check: string, role: string): string =>
        `${checked(table, check)} ALTER TABLE s.${table} OWNER TO "${role}";`;
      const planned = await planAgainst(
        "frontend_settle_eo",
        `CREATE SCHEMA s; ${owned("kept", flat(10), owner)} ${owned("gone", flat(9), applier)}`,
        `CREATE SCHEMA s; ${owned("renamed", flat(10), owner)} ${owned("added", between(10), applier)}`,
        { applier },
      );
      expect(sqlOf(planned)).toMatchInlineSnapshot(`
        [
          "DROP TABLE "s"."gone"",
          "CREATE TABLE "s"."added" ("a" integer, "b" integer, CONSTRAINT "ck" CHECK ((((b >= 0) AND (b <= 10)) AND (a >= 0))))",
          "ALTER TABLE "s"."kept" RENAME TO "renamed"",
        ]
      `);
    });
  }, 120_000);

  test("planSchemaFiles never loses an exact rename once a counterpart runs out of old names (#535)", async () => {
    // s.added pairs only with s.gone, whose rename never lands; its own stable
    // text then equals s.kept's, which would make s.kept -> s.renamed ambiguous.
    const table = (name: string, dflt: number, check: string): string =>
      `CREATE TABLE s.${name} (a int DEFAULT ${dflt}, b int, c int, CONSTRAINT ck CHECK (${check}));`;
    const kept =
      "a IS DISTINCT FROM 1 OR b IS DISTINCT FROM 2 OR c IS DISTINCT FROM 3";
    const planned = await planAgainst(
      "frontend_settle_x",
      `CREATE SCHEMA s; ${table("kept", 2, kept)} ${table("gone", 1, "((a, b), c) IS DISTINCT FROM ((1, 2), 3)")}`,
      `CREATE SCHEMA s; ${table("renamed", 2, kept)} ${table("added", 2, "(a, b) IS DISTINCT FROM (1, 2) OR c IS DISTINCT FROM 3")}`,
    );
    expect(sqlOf(planned)).toMatchInlineSnapshot(`
      [
        "DROP TABLE "s"."gone"",
        "CREATE TABLE "s"."added" ("a" integer DEFAULT 2, "b" integer, "c" integer, CONSTRAINT "ck" CHECK ((((a IS DISTINCT FROM 1) OR (b IS DISTINCT FROM 2)) OR (c IS DISTINCT FROM 3))))",
        "ALTER TABLE "s"."kept" RENAME TO "renamed"",
      ]
    `);
  }, 120_000);

  test("planSchemaFiles never settles a name an ambiguous rename claims (#535)", async () => {
    // s.a1 and s.a2 both match s.t exactly; settling s.b must not single it out.
    const planned = await planAgainst(
      "frontend_settle_a",
      `CREATE SCHEMA s; ${checked("a1", between(10))} ${checked("a2", between(10))} ${checked("b", flat(10))}`,
      `CREATE SCHEMA s; ${checked("t", between(10))}`,
    );
    expect(sqlOf(planned)).toMatchInlineSnapshot(`
      [
        "DROP TABLE "s"."a1"",
        "DROP TABLE "s"."a2"",
        "DROP TABLE "s"."b"",
        "CREATE TABLE "s"."t" ("a" integer, "b" integer, CONSTRAINT "ck" CHECK ((((b >= 0) AND (b <= 10)) AND (a >= 0))))",
      ]
    `);
  }, 120_000);

  test("planSchemaFiles pairs a renamed table's managed descendants only (#535)", async () => {
    // The indexes are outside the profile, so s.t2 lacking them must not
    // stop s.t1's subtree from pairing with its own.
    const profile: IntegrationProfile = {
      id: "ignore-indexes",
      handlers: [],
      policy: {
        id: "ignore-indexes",
        filter: [{ match: { kind: "index" }, action: "exclude" }],
      },
    };
    const planned = await planAgainst(
      "frontend_settle_x",
      `${renamedT1} CREATE INDEX i1 ON s.t1 (a);`,
      `CREATE SCHEMA s; ${checked("t2", between(10))}`,
      { profile },
    );
    expect(sqlOf(planned)).toMatchInlineSnapshot(`
      [
        "ALTER TABLE "s"."t1" RENAME TO "t2"",
      ]
    `);
  }, 120_000);

  test("planSchemaFiles keeps the applier's projection while settling (#535)", async () => {
    // A non-superuser cannot grant on a foreign-data wrapper, so the grant is
    // projected out; collecting what to settle must not plan it anyway.
    const [clusterA, clusterB] = await isolatedClusterPair();
    const rolesBeforeA = await clusterA.listRoles();
    const rolesBeforeB = await clusterB.listRoles();
    const applier = `frontend_settle_fdw_app_${Date.now().toString(36)}`;
    const target = await clusterA.createDb("frontend_settle_f_target");
    const shadow = await clusterB.createDb("frontend_settle_f_shadow");
    let applierPool: pg.Pool | undefined;
    try {
      await clusterA.adminPool.query(
        `CREATE ROLE "${applier}" LOGIN NOSUPERUSER PASSWORD '${applier}'`,
      );
      await target.pool.query(`
        GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO "${applier}";
        CREATE FOREIGN DATA WRAPPER w NO HANDLER NO VALIDATOR;
      `);
      await clusterB.adminPool.query(`CREATE ROLE frontend_settle_shadow_only`);
      applierPool = loginPool(target.uri, applier);
      const files: SqlFile[] = [
        {
          name: "w.sql",
          sql: `
            CREATE FOREIGN DATA WRAPPER w NO HANDLER NO VALIDATOR;
            GRANT USAGE ON FOREIGN DATA WRAPPER w TO frontend_settle_shadow_only;
          `,
        },
      ];
      const planned = await planSchemaFiles(applierPool, shadow.pool, files, {
        profile: rawProfile,
        scope: "database",
        isolatedShadow: true,
      });
      expect(sqlOf(planned)).toEqual([]);
    } finally {
      await applierPool?.end();
      await Promise.all([target.drop(), shadow.drop()]);
      await Promise.all([
        clusterA.dropRolesExcept(rolesBeforeA, { strict: true }),
        clusterB.dropRolesExcept(rolesBeforeB, { strict: true }),
      ]);
    }
  }, 120_000);

  test("planSchemaFiles pairs a renamed table's grants by grantee (#535)", async () => {
    // Grants to two roles hold the same privileges and have no name.
    await withOwnerAndApplier("frontend_settle_acl", async (r1, r2) => {
      const granted = (table: string, check: string, to: string): string =>
        `CREATE SCHEMA s; ${checked(table, check)}
         GRANT SELECT ON s.${table} TO ${to};`;
      const plan = async (name: string, from: string) =>
        sqlOf(
          await planAgainst(
            name,
            granted("t1", flat(10), from),
            granted("t2", between(10), `"${r1}", "${r2}"`),
          ),
        ).map((sql) => sql.replaceAll(r1, "r1").replaceAll(r2, "r2"));
      expect(await plan("frontend_settle_acl", `"${r1}", "${r2}"`))
        .toMatchInlineSnapshot(`
          [
            "ALTER TABLE "s"."t1" RENAME TO "t2"",
          ]
        `);
      // a grant to another role is a real change, never paired
      expect(await plan("frontend_settle_acl2", `"${r1}", PUBLIC`))
        .toMatchInlineSnapshot(`
          [
            "DROP TABLE "s"."t1"",
            "CREATE TABLE "s"."t2" ("a" integer, "b" integer, CONSTRAINT "ck" CHECK ((((b >= 0) AND (b <= 10)) AND (a >= 0))))",
            "GRANT SELECT ON TABLE "s"."t2" TO "r2", "r1"",
          ]
        `);
    });
  }, 120_000);

  test("planSchemaFiles pairs unnamed checks by structure, then by text, across a rename (#535)", async () => {
    const plan = (name: string, extra: string) =>
      planAgainst(
        name,
        `CREATE SCHEMA s; CREATE TABLE s.t1 (a int, b int, CHECK (${flat(10)})${extra});`,
        `CREATE SCHEMA s; CREATE TABLE s.t2 (a int, b int, CHECK (${between(10)})${extra});`,
      );
    expect(sqlOf(await plan("frontend_settle_u", ""))).toMatchInlineSnapshot(`
      [
        "ALTER TABLE "s"."t1" RENAME TO "t2"",
      ]
    `);
    expect(sqlOf(await plan("frontend_settle_u2", ", CHECK (a < 100)")))
      .toMatchInlineSnapshot(`
      [
        "ALTER TABLE "s"."t1" RENAME TO "t2"",
      ]
    `);
  }, 120_000);

  test("planSchemaFiles never probes the profile's assumed schemas in an isolated shadow (supabase/cli#6453)", async () => {
    const platformProfile: IntegrationProfile = {
      id: "test-platform-unreadable",
      handlers: [],
      policy: {
        id: "test-platform-unreadable",
        filter: [
          {
            match: { any: [{ schema: "_realtime" }, { name: "_realtime" }] },
            action: "exclude",
          },
          {
            match: {
              all: [
                { kind: ["acl", "comment", "securityLabel"] },
                {
                  any: [
                    { target: { schema: "_realtime" } },
                    { target: { kind: "schema", name: "_realtime" } },
                  ],
                },
              ],
            },
            action: "exclude",
          },
        ],
        assumedSchemas: ["_realtime"],
      },
    };
    const [clusterA, clusterB] = await isolatedClusterPair();
    const rolesBeforeA = await clusterA.listRoles();
    const rolesBeforeB = await clusterB.listRoles();
    const applier = `frontend_applier_${Date.now().toString(36)}`;
    const target = await clusterA.createDb("frontend_unreadable_target");
    const shadow = await clusterB.createDb("frontend_unreadable_shadow");
    let applierPool: pg.Pool | undefined;
    try {
      const USER_SQL = "CREATE TABLE public.widgets (id integer PRIMARY KEY);";
      await target.pool.query(`
        CREATE ROLE "${applier}";
        GRANT ALL ON SCHEMA public TO "${applier}";
        ${USER_SQL}
        ALTER TABLE public.widgets OWNER TO "${applier}";
      `);
      await clusterB.adminPool.query(
        `CREATE ROLE "${applier}" LOGIN NOSUPERUSER PASSWORD 'applier'`,
      );
      await shadow.pool.query(`
        CREATE SCHEMA _realtime;
        CREATE TABLE _realtime.schema_migrations (version bigint PRIMARY KEY);
        INSERT INTO _realtime.schema_migrations VALUES (20210706140551);
        GRANT USAGE ON SCHEMA _realtime TO "${applier}";
        GRANT ALL ON SCHEMA public TO "${applier}";
      `);
      const url = new URL(shadow.uri);
      url.username = applier;
      url.password = "applier";
      applierPool = new pg.Pool({ connectionString: url.toString(), max: 5 });
      applierPool.on("error", () => {});
      const files: SqlFile[] = [{ name: "app.sql", sql: USER_SQL }];
      const planned = await planSchemaFiles(target.pool, applierPool, files, {
        profile: platformProfile,
        scope: "database",
        isolatedShadow: true,
        strictDataStatements: true,
      });
      expect(planned.plan.actions).toEqual([]);
    } finally {
      await applierPool?.end();
      await Promise.all([target.drop(), shadow.drop()]);
      await Promise.all([
        clusterA.dropRolesExcept(rolesBeforeA, { strict: true }),
        clusterB.dropRolesExcept(rolesBeforeB, { strict: true }),
      ]);
    }
  }, 120_000);

  test("planSchemaFiles permits a non-isolated database-scope sibling from the same lineage", async () => {
    const cluster = await sharedCluster();
    const target = await cluster.createDb("frontend_sibling_target");
    const shadow = await cluster.createDb("frontend_sibling_shadow");
    try {
      const files: SqlFile[] = [
        {
          name: "schema.sql",
          sql: "CREATE SCHEMA allowed_same_lineage_sibling;\n",
        },
      ];
      const planned = await planSchemaFiles(target.pool, shadow.pool, files, {
        profile: rawProfile,
        scope: "database",
      });
      expect(
        planned.plan.actions.some((action) =>
          action.sql.includes("allowed_same_lineage_sibling"),
        ),
      ).toBe(true);
      expect(
        await target.pool.query(
          `SELECT to_regnamespace('allowed_same_lineage_sibling') IS NULL AS absent`,
        ),
      ).toMatchObject({ rows: [{ absent: true }] });
    } finally {
      await Promise.all([target.drop(), shadow.drop()]);
    }
  }, 90_000);

  test("planSchemaFiles + renderPlanFiles preserve preamble and apply converges", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("frontend_plan_src");
    const target = await cluster.createDb("frontend_plan_tgt");
    try {
      // Include a routine so the plan carries the check_function_bodies
      // preamble — the planner emits it only for routine-touching plans
      // (src/plan/preamble.ts), and search_path is filtered from rendered
      // files, so a table-only plan would render no settings at all.
      await source.pool.query(`
        ${SCHEMA_SQL}
        CREATE FUNCTION app.item_count() RETURNS integer
          LANGUAGE sql STABLE AS 'SELECT count(*)::integer FROM app.items';
      `);
      const exported = await buildSchemaExport(source.pool, {
        profile: rawProfile,
        scope: "database",
        layout: "ordered",
        format: { keywordCase: "lower", maxWidth: 180 },
      });

      const shadow = await provisionCoLocatedShadow(target.uri, {
        uniqueSuffix: `ok_${Date.now().toString(36)}`,
      });
      const shadowPool = new pg.Pool({ connectionString: shadow.url, max: 5 });
      try {
        const planned = await planSchemaFiles(
          target.pool,
          shadowPool,
          exported.files,
          {
            profile: rawProfile,
            scope: "database",
            manifest: exported.manifest,
            seedAssumedSchemas: true,
          },
        );
        expect(planned.plan.actions.length).toBeGreaterThan(0);

        const rendered = renderPlanFiles(planned.plan, { allowDrops: true });
        expect(rendered.changes).toBe(true);
        expect(rendered.files.length).toBeGreaterThan(0);
        // search_path is deliberately excluded from rendered files (dbmate
        // appends an unqualified bookkeeping INSERT in the same transaction);
        // the routine above guarantees check_function_bodies survives.
        expect(
          planned.plan.preamble.some((s) => s.name === "check_function_bodies"),
        ).toBe(true);
        for (const file of rendered.files) {
          expect(file.contents).toContain("check_function_bodies = off;");
        }

        const report = await apply(planned.plan, target.pool, {
          ...planned.applyOptions,
          fingerprintGate: true,
          sourceFactBase: planned.targetFactBase,
        });
        expect(report.status).toBe("applied");
      } finally {
        await shadowPool.end();
        await shadow.cleanup();
      }
    } finally {
      await Promise.all([source.drop(), target.drop()]);
    }
  }, 120_000);

  test("assumed-schema seeding omits a reference-only overlay with a managed dependency", async () => {
    // A reference-only object can DEPEND on a MANAGED one: here a policy on the
    // assumed `platform.objects` whose expression calls a user function and casts
    // to a user domain, both in the managed `app` schema. `app` only exists AFTER
    // the declarative files load, so replaying that policy during the seed phase
    // failed the whole seed with `schema "app" does not exist`. The policy must be
    // omitted WHOLE from the seed (never rewritten) while the useful assumed table
    // is still seeded — and because a reference-only fact is skipped by the diff on
    // both sides, its absence produces no spurious create/drop.
    const platformPolicy: Policy = {
      id: "test-platform-seed",
      filter: [
        {
          match: { any: [{ schema: "platform" }, { name: "platform" }] },
          action: "exclude",
        },
      ],
      assumedSchemas: ["platform"],
    };
    const platformProfile: IntegrationProfile = {
      id: "test-platform-seed",
      handlers: [],
      policy: platformPolicy,
    };
    const appSql = `
      CREATE SCHEMA app;
      CREATE DOMAIN app.valid_name AS text CHECK (length(value) > 0);
      CREATE FUNCTION app.is_handle_maintainer(h text) RETURNS boolean
        LANGUAGE sql IMMUTABLE AS $$ SELECT h IS NOT NULL $$;
      CREATE TABLE app.links (
        id integer PRIMARY KEY,
        object_id integer REFERENCES platform.objects(id)
      );
    `;
    const platformSql = `
      CREATE SCHEMA platform;
      CREATE TABLE platform.objects (id integer PRIMARY KEY, name text NOT NULL);
      ALTER TABLE platform.objects ENABLE ROW LEVEL SECURITY;
    `;
    // The cross-layer overlay: reference-only (schema platform) but depending on
    // BOTH managed app objects. Applied last — even the target can only create it
    // once both layers exist, which is exactly why the seed cannot replay it.
    const crossLayerPolicySql = `
      CREATE POLICY cross_layer ON platform.objects
        USING (app.is_handle_maintainer(name) AND (name::app.valid_name) IS NOT NULL);
    `;

    const cluster = await sharedCluster();
    const target = await cluster.createDb("frontend_seed_managed_dep");
    try {
      // the platform layer must exist before the app layer's FK to it, and both
      // before the policy that spans them.
      await target.pool.query(platformSql);
      await target.pool.query(appSql);
      await target.pool.query(crossLayerPolicySql);

      const shadow = await provisionCoLocatedShadow(target.uri, {
        uniqueSuffix: `seedmd_${Date.now().toString(36)}`,
      });
      const shadowPool = new pg.Pool({ connectionString: shadow.url, max: 5 });
      try {
        // declarative files declare ONLY the managed app layer; the assumed
        // platform layer arrives via the seed.
        const files: SqlFile[] = [{ name: "app.sql", sql: appSql }];
        const planned = await planSchemaFiles(target.pool, shadowPool, files, {
          profile: platformProfile,
          scope: "database",
          seedAssumedSchemas: true,
        });

        // the useful assumed table WAS seeded (the app FK could not load otherwise).
        expect(
          await shadowPool.query(
            `SELECT to_regclass('platform.objects') IS NOT NULL AS present`,
          ),
        ).toMatchObject({ rows: [{ present: true }] });
        // the cross-layer policy was NOT part of the seed.
        expect(
          await shadowPool.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'platform'`,
          ),
        ).toMatchObject({ rows: [{ n: 0 }] });
        // the declarative app layer loaded.
        expect(
          await shadowPool.query(
            `SELECT to_regclass('app.links') IS NOT NULL AS present`,
          ),
        ).toMatchObject({ rows: [{ present: true }] });
        // reference-only on both sides ⇒ no create/drop for the omitted policy,
        // and the managed state matches ⇒ an empty plan.
        expect(
          planned.plan.actions.filter((a) => /cross_layer/i.test(a.sql)),
        ).toEqual([]);
        expect(planned.plan.actions.map((a) => a.sql)).toEqual([]);
      } finally {
        await shadowPool.end();
        await shadow.cleanup();
      }
    } finally {
      await target.drop();
    }
  }, 120_000);

  test("buildSchemaExport does not revoke a policy-filtered grant on public", async () => {
    const profile: IntegrationProfile = {
      id: "test-filtered-public-acl",
      handlers: [],
      policy: {
        id: "test-filtered-public-acl",
        filter: [
          {
            match: {
              all: [
                { kind: "acl" },
                { target: { kind: "schema", name: "public" } },
                { idField: { field: "grantee", glob: "PUBLIC" } },
              ],
            },
            action: "exclude",
          },
        ],
      },
    };
    const cluster = await sharedCluster();
    const source = await cluster.createDb("frontend_filtered_public_acl");
    try {
      /* the source still grants PUBLIC USAGE, the policy only stops managing it */
      const { files } = await buildSchemaExport(source.pool, { profile });
      expect(files.map((f) => f.sql).join("\n")).not.toContain(
        `REVOKE ALL ON SCHEMA "public" FROM PUBLIC`,
      );
      /* revoking the grant does not bring it under management */
      await source.pool.query(`REVOKE ALL ON SCHEMA public FROM PUBLIC`);
      const revoked = await buildSchemaExport(source.pool, { profile });
      expect(revoked.files.map((f) => f.sql).join("\n")).not.toContain(
        `REVOKE ALL ON SCHEMA "public" FROM PUBLIC`,
      );
    } finally {
      await source.drop();
    }
  }, 120_000);

  test("exportSqlFiles preserves default public grants when all public ACLs are filtered", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("frontend_direct_public");
    const shadow = await cluster.createDb("frontend_direct_public_shadow");
    try {
      await source.pool.query(`CREATE TABLE public.items (id integer)`);
      const { factBase } = await extract(source.pool);
      const view = reconstructManagedView(factBase, {
        scope: "database",
        policy: {
          id: "test-direct-filtered-public-acl",
          filter: [
            {
              match: {
                all: [
                  { kind: "acl" },
                  { target: { kind: "schema", name: "public" } },
                ],
              },
              action: "exclude",
            },
          ],
        },
      });
      const files = exportSqlFiles(view);
      expect(files.map((f) => f.sql).join("\n")).not.toContain("REVOKE");
      const loaded = await loadSqlFiles(files, shadow.pool);
      expect(loaded.factBase.rootHash).toBe(factBase.rootHash);
    } finally {
      await Promise.all([source.drop(), shadow.drop()]);
    }
  }, 120_000);

  test("a policy baseline keeps the public revoke in exported files", async () => {
    const profile: IntegrationProfile = {
      id: "test-baseline-public",
      handlers: [],
      policy: { id: "test-baseline-public", baseline: "fresh" },
    };
    const cluster = await sharedCluster();
    const source = await cluster.createDb("frontend_baseline_public");
    const shadow = await cluster.createDb("frontend_baseline_public_shadow");
    const baselineDir = mkdtempSync(join(tmpdir(), "pgdn-fe-baseline-"));
    try {
      /* the baseline is a fresh database, so it holds PUBLIC's grant on public */
      const { factBase, pgVersion } = await extract(source.pool);
      saveSnapshot(factBase, pgVersion, join(baselineDir, "fresh.json"));
      await source.pool.query(`REVOKE ALL ON SCHEMA public FROM PUBLIC`);

      const exported = await buildSchemaExport(source.pool, {
        profile,
        resolveOptions: { baselineDir },
      });
      expect(exported.files.map((f) => f.sql).join("\n"))
        .toMatchInlineSnapshot(`
        "REVOKE ALL ON SCHEMA "public" FROM PUBLIC;
        "
      `);
      const planned = await planSchemaFiles(
        source.pool,
        shadow.pool,
        exported.files,
        {
          profile,
          manifest: exported.manifest,
          resolveOptions: { baselineDir },
        },
      );
      // Load/sync smoke check only: the baseline masks this grant on sync (#531).
      // The export snapshot above is the regression assertion.
      expect(planned.plan.actions.map((a) => a.sql)).toEqual([]);
    } finally {
      rmSync(baselineDir, { recursive: true, force: true });
      await Promise.all([source.drop(), shadow.drop()]);
    }
  }, 120_000);

  test("manifest mismatches fail closed before planning", async () => {
    const cluster = await sharedCluster();
    const target = await cluster.createDb("frontend_mm");
    const dir = mkdtempSync(join(tmpdir(), "pgdn-fe-manifest-"));
    try {
      const files: SqlFile[] = [
        { name: "t.sql", sql: "CREATE TABLE public.t (id int);\n" },
      ];
      writeExportManifest(dir, {
        redactSecrets: true,
        profile: "supabase",
        scope: "database",
        baselineDigest: "deadbeef",
      });
      const manifest = readExportManifest(dir);
      expect(
        planSchemaFiles(target.pool, target.pool, files, {
          profile: rawProfile,
          scope: "database",
          ...(manifest !== undefined ? { manifest } : {}),
        }),
      ).rejects.toThrow(/profile|baseline/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await target.drop();
    }
  }, 90_000);

  test("pool/shadow cleanup occurs on success and on plan failure", async () => {
    const cluster = await sharedCluster();
    const target = await cluster.createDb("frontend_cln");
    try {
      const shadow = await provisionCoLocatedShadow(target.uri, {
        uniqueSuffix: `cln_${Date.now().toString(36)}`,
      });
      const name = shadow.name;
      const sp = new pg.Pool({ connectionString: shadow.url, max: 5 });
      try {
        expect(
          planSchemaFiles(target.pool, sp, [{ name: "c.sql", sql: "--\n" }], {
            profile: rawProfile,
            scope: "database",
          }),
        ).rejects.toThrow(/no executable SQL/);
      } finally {
        await sp.end();
        await shadow.cleanup();
      }
      const check = await target.cluster.adminPool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_database WHERE datname = $1`,
        [name],
      );
      expect(check.rows[0]?.n).toBe(0);

      const shadow2 = await provisionCoLocatedShadow(target.uri, {
        uniqueSuffix: `ok2_${Date.now().toString(36)}`,
      });
      const name2 = shadow2.name;
      await shadow2.cleanup();
      const check2 = await target.cluster.adminPool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_database WHERE datname = $1`,
        [name2],
      );
      expect(check2.rows[0]?.n).toBe(0);
    } finally {
      await target.drop();
    }
  }, 90_000);

  test("ShadowProvisionError when role lacks CREATEDB", async () => {
    const cluster = await sharedCluster();
    const target = await cluster.createDb("frontend_nocreate");
    const role = `nocreatedb_${Date.now().toString(36)}`;
    try {
      await target.cluster.adminPool.query(
        `CREATE ROLE ${role} LOGIN PASSWORD 'x' NOSUPERUSER NOCREATEDB`,
      );
      const u = new URL(target.uri);
      u.username = role;
      u.password = "x";
      expect(provisionCoLocatedShadow(u.toString())).rejects.toBeInstanceOf(
        ShadowProvisionError,
      );
    } finally {
      await target.cluster.adminPool
        .query(`DROP ROLE IF EXISTS ${role}`)
        .catch(() => {});
      await target.drop();
    }
  }, 90_000);
});
