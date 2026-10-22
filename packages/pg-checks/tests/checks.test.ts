/**
 * RFC §9 on real supabase/postgres images, through a CLI-faithful executor.
 * Tests in one image run serially on one cluster: D1 checks every finding in the
 * exposed schemas, so each test owns a schema and passes it as the only exposed one.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type pg from "pg";
import { buildCheckBlock, resolvePolicy } from "../src/index.ts";
import { applyMigrationLikeCli, readFindings } from "./cli-executor.ts";
import {
  SUPABASE_IMAGES,
  type SupabasePostgres,
  startSupabasePostgres,
} from "./supabase-postgres.ts";

const majors = (process.env["PGCHECKS_PG"] ?? "17,15").split(
  ",",
) as (keyof typeof SUPABASE_IMAGES)[];

const errorOn = (rule: string, extra: Record<string, unknown> = {}) =>
  resolvePolicy({ [rule]: "error", ...extra });

describe.each(majors)("supabase/postgres %s", (major) => {
  let db: SupabasePostgres;
  let client: pg.Client;
  let seq = 0;

  beforeAll(async () => {
    db = await startSupabasePostgres(SUPABASE_IMAGES[major]);
    client = await db.connect("postgres");
  }, 240_000);

  afterAll(async () => {
    await client?.end();
    await db?.stop();
  });

  /** A schema exposed to anon/authenticated like `public`, plus a fresh version. */
  async function fixture(on: pg.Client = client) {
    seq += 1;
    const schema = `s${seq}`;
    await on.query(`create schema ${schema};
      grant usage on schema ${schema} to anon, authenticated;
      alter default privileges in schema ${schema} grant select on tables to anon, authenticated;`);
    return {
      schema,
      version: `${20260101000000 + seq}`,
      exposedSchemas: [schema],
    };
  }

  const exists = async (relation: string) =>
    (
      await client.query(
        "select pg_catalog.to_regclass($1) is not null as ok",
        [relation],
      )
    ).rows[0].ok as boolean;
  const historyRows = async (version: string) =>
    Number(
      (
        await client.query(
          "select count(*) from supabase_migrations.schema_migrations where version = $1",
          [version],
        )
      ).rows[0].count,
    );

  test("a blocked file leaves no object and no history row", async () => {
    const { schema, version, exposedSchemas } = await fixture();
    const result = await applyMigrationLikeCli(
      client,
      {
        version,
        name: "blocked",
        statements: [`create table ${schema}.t (id int primary key)`],
      },
      errorOn("rls_disabled_in_public"),
      { exposedSchemas },
    );
    expect(result.outcome).toBe("blocked");
    if (result.outcome !== "blocked" || result.check.kind !== "blocked") return;
    expect(
      result.check.errors.map((f) => [f.rule, f.schema, f.name, f.type]),
    ).toEqual([["rls_disabled_in_public", schema, "t", "table"]]);
    expect(await exists(`${schema}.t`)).toBe(false);
    expect(await historyRows(version)).toBe(0);
  });

  test("the same block through pg-meta's role and a one-string begin/commit batch", async () => {
    const admin = await db.connect("supabase_admin");
    try {
      const { schema, version, exposedSchemas } = await fixture(admin);
      const block = buildCheckBlock(errorOn("rls_disabled_in_public"), {
        exposedSchemas,
      });
      const error = await admin
        .query(
          `begin;
create table ${schema}.t (id int primary key);
${block}
insert into supabase_migrations.schema_migrations(version, name, statements) values ('${version}', 'mgmt', '{}');
commit;`,
        )
        .then(
          () => null,
          (e: unknown) => e as { code?: string; detail?: string },
        );
      expect(error?.code).toBe("SB001");
      expect(JSON.parse(error?.detail ?? "{}").errors[0].metadata).toEqual({
        schema,
        name: "t",
        type: "table",
      });
      await admin.query("rollback");
      expect(await exists(`${schema}.t`)).toBe(false);
      expect(await historyRows(version)).toBe(0);
    } finally {
      await admin.end();
    }
  });

  test("a passing check restores the file's own SET LOCALs before the history insert", async () => {
    const { schema, version, exposedSchemas } = await fixture();
    await client.query(`create schema if not exists obs;
      create table if not exists obs.seen (version text, statement_timeout text, search_path text, db_schemas text);
      create or replace function obs.record() returns trigger language plpgsql as $$
      begin
        insert into obs.seen values (new.version, pg_catalog.current_setting('statement_timeout'),
          pg_catalog.current_setting('search_path'), pg_catalog.current_setting('pgrst.db_schemas', true));
        return new;
      end $$;
      create or replace trigger record before insert on supabase_migrations.schema_migrations
        for each row execute function obs.record();`);
    const result = await applyMigrationLikeCli(
      client,
      {
        version,
        name: "secure",
        statements: [
          "set local statement_timeout = '7min'",
          `set local search_path = ${schema}, public`,
          "select pg_catalog.set_config('pgrst.db_schemas', 'mine', true)",
          "create table t (id int primary key)",
          "alter table t enable row level security",
          "create policy p on t for select to authenticated using (auth.uid() is not null)",
        ],
      },
      errorOn("rls_disabled_in_public", { rls_enabled_no_policy: "error" }),
      { exposedSchemas },
    );
    expect(result.outcome).toBe("applied");
    expect(await historyRows(version)).toBe(1);
    const seen = await client.query(
      "select * from obs.seen where version = $1",
      [version],
    );
    expect(seen.rows[0]).toEqual({
      version,
      statement_timeout: "7min",
      search_path: `${schema}, public`,
      db_schemas: "mine",
    });
    await client.query(
      "drop trigger record on supabase_migrations.schema_migrations",
    );
  });

  test("nothing the check sets leaks into the session after commit or rollback", async () => {
    const { schema, version, exposedSchemas } = await fixture();
    const settings = async () =>
      (
        await client.query(
          "select pg_catalog.current_setting('statement_timeout') as st, pg_catalog.current_setting('search_path') as sp, pg_catalog.current_setting('pgrst.db_schemas', true) as dbs",
        )
      ).rows[0];
    await client.query("set statement_timeout = '42s'");
    const before = await settings();
    const policy = errorOn("rls_disabled_in_public");
    const applied = await applyMigrationLikeCli(
      client,
      { version, name: "ok", statements: ["select 1"] },
      policy,
      { exposedSchemas },
    );
    expect(applied.outcome).toBe("applied");
    // applyMigrationLikeCli starts with RESET ALL, like the CLI.
    expect((await settings()).st).toBe("0");
    await client.query("set statement_timeout = '42s'");
    const blocked = await applyMigrationLikeCli(
      client,
      {
        version: `${version}1`,
        name: "no",
        statements: [`create table ${schema}.t (id int)`],
      },
      policy,
      { exposedSchemas },
    );
    expect(blocked.outcome).toBe("blocked");
    await client.query("set statement_timeout = '42s'");
    await readFindings(client, resolvePolicy({}), exposedSchemas);
    const after = await settings();
    expect(after.st).toBe(before.st);
    expect(after.sp).toBe(before.sp);
    // A placeholder set with is_local survives the transaction as '' (not NULL):
    // splinter then sees no exposed schema, so every read must set it (O23).
    expect(before.dbs === null || before.dbs === "").toBe(true);
    expect(after.dbs).toBe("");
  });

  test("warn applies the file and the after-commit read reports it", async () => {
    const { schema, version, exposedSchemas } = await fixture();
    const policy = resolvePolicy({});
    const result = await applyMigrationLikeCli(
      client,
      {
        version,
        name: "warn",
        statements: [`create table ${schema}.t (id int primary key)`],
      },
      policy,
      { exposedSchemas },
    );
    expect(result.outcome).toBe("applied");
    expect(await exists(`${schema}.t`)).toBe(true);
    expect(await historyRows(version)).toBe(1);
    const findings = await readFindings(client, policy, exposedSchemas);
    expect(
      findings
        .filter((f) => f.schema === schema)
        .map((f) => [f.rule, f.severity, f.name]),
    ).toEqual([["rls_disabled_in_public", "warn", "t"]]);
  });

  test("off skips the rule in the check and in the read", async () => {
    const { schema, version, exposedSchemas } = await fixture();
    const policy = resolvePolicy({
      rls_disabled_in_public: "off",
      rls_enabled_no_policy: "error",
    });
    const result = await applyMigrationLikeCli(
      client,
      {
        version,
        name: "off",
        statements: [`create table ${schema}.t (id int primary key)`],
      },
      policy,
      { exposedSchemas },
    );
    expect(result.outcome).toBe("applied");
    const findings = await readFindings(client, policy, exposedSchemas);
    expect(findings.filter((f) => f.schema === schema)).toEqual([]);
  });

  test("exclude skips only that relation", async () => {
    const { schema, version, exposedSchemas } = await fixture();
    const policy = errorOn("rls_disabled_in_public", {
      exclude: { rls_disabled_in_public: [`${schema}.legacy`] },
    });
    const both = await applyMigrationLikeCli(
      client,
      {
        version,
        name: "both",
        statements: [
          `create table ${schema}.legacy (id int)`,
          `create table ${schema}.fresh (id int)`,
        ],
      },
      policy,
      { exposedSchemas },
    );
    expect(both.outcome).toBe("blocked");
    if (both.outcome !== "blocked" || both.check.kind !== "blocked") return;
    expect(both.check.errors.map((f) => f.name)).toEqual(["fresh"]);
    const legacyOnly = await applyMigrationLikeCli(
      client,
      {
        version,
        name: "legacy",
        statements: [`create table ${schema}.legacy (id int)`],
      },
      policy,
      { exposedSchemas },
    );
    expect(legacyOnly.outcome).toBe("applied");
    expect(await exists(`${schema}.legacy`)).toBe(true);
  });

  test("an exclusion for one rule leaves the same object reported under another rule", async () => {
    const { schema, version, exposedSchemas } = await fixture();
    const policy = errorOn("rls_disabled_in_public", {
      policy_exists_rls_disabled: "error",
      exclude: { rls_disabled_in_public: [`${schema}.t`] },
    });
    const result = await applyMigrationLikeCli(
      client,
      {
        version,
        name: "per-rule",
        statements: [
          `create table ${schema}.t (id int primary key)`,
          `create policy p on ${schema}.t using (true)`,
        ],
      },
      policy,
      { exposedSchemas },
    );
    expect(result.outcome).toBe("blocked");
    if (result.outcome !== "blocked" || result.check.kind !== "blocked") return;
    expect(result.check.errors.map((f) => [f.rule, f.name])).toEqual([
      ["policy_exists_rls_disabled", "t"],
    ]);
    const open = errorOn("rls_disabled_in_public", {
      policy_exists_rls_disabled: "off",
      exclude: { rls_disabled_in_public: [`${schema}.t`] },
    });
    const findings = await readFindings(client, open, exposedSchemas);
    expect(findings.filter((f) => f.schema === schema)).toEqual([]);
  });

  test("a check over its timeout fails closed with SB002 and rolls back", async () => {
    const { schema, version, exposedSchemas } = await fixture();
    const result = await applyMigrationLikeCli(
      client,
      {
        version,
        name: "slow",
        statements: [`create table ${schema}.t (id int primary key)`],
      },
      errorOn("rls_disabled_in_public"),
      { exposedSchemas, timeoutMs: 1 },
    );
    expect(result.outcome).toBe("timed_out");
    expect(await exists(`${schema}.t`)).toBe(false);
    expect(await historyRows(version)).toBe(0);
  });

  test("the check timeout does not cut the file's own slow statement", async () => {
    const { schema, version, exposedSchemas } = await fixture();
    const result = await applyMigrationLikeCli(
      client,
      {
        version,
        name: "slow-file",
        statements: [
          "select pg_catalog.pg_sleep(0.6)",
          `create table ${schema}.t (id int primary key)`,
          `alter table ${schema}.t enable row level security`,
        ],
      },
      errorOn("rls_disabled_in_public"),
      { exposedSchemas, timeoutMs: 500 },
    );
    expect(result.outcome).toBe("applied");
  });

  test("only the exposed schemas passed in are checked by exposure-scoped rules", async () => {
    const { schema, version } = await fixture();
    const policy = errorOn("rls_disabled_in_public");
    const unexposed = await applyMigrationLikeCli(
      client,
      {
        version,
        name: "hidden",
        statements: [`create table ${schema}.t (id int)`],
      },
      policy,
      {},
    );
    expect(unexposed.outcome).toBe("applied");
    expect(
      (await readFindings(client, policy, ["public", schema])).map((f) => [
        f.schema,
        f.name,
      ]),
    ).toContainEqual([schema, "t"]);
  });

  test("rules that ignore pgrst.db_schemas see every user schema", async () => {
    const { schema, version } = await fixture();
    const policy = errorOn("rls_enabled_no_policy");
    const result = await applyMigrationLikeCli(
      client,
      {
        version,
        name: "rls-no-policy",
        statements: [
          `create table ${schema}.t (id int)`,
          `alter table ${schema}.t enable row level security`,
        ],
      },
      policy,
      { exposedSchemas: ["public"] },
    );
    expect(result.outcome).toBe("blocked");
  });

  test("a file the CLI splits applies without the in-transaction check, then reports", async () => {
    const { schema, version, exposedSchemas } = await fixture();
    const policy = errorOn("rls_disabled_in_public");
    const concurrently = await applyMigrationLikeCli(
      client,
      {
        version,
        name: "concurrently",
        statements: [
          `create table ${schema}.t (id int)`,
          `create index concurrently t_id on ${schema}.t (id)`,
        ],
      },
      policy,
      { exposedSchemas },
    );
    expect(concurrently).toMatchObject({ outcome: "applied", split: true });
    const authored = await applyMigrationLikeCli(
      client,
      {
        version: `${version}1`,
        name: "authored",
        statements: ["begin", `create table ${schema}.u (id int)`, "commit"],
      },
      policy,
      { exposedSchemas },
    );
    expect(authored).toMatchObject({ outcome: "applied", split: true });
    expect(await historyRows(version)).toBe(1);
    const findings = await readFindings(client, policy, exposedSchemas);
    expect(
      findings
        .filter((f) => f.schema === schema)
        .map((f) => [f.severity, f.name]),
    ).toEqual([
      ["error", "t"],
      ["error", "u"],
    ]);
  });
});
