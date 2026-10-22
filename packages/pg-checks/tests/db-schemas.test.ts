/**
 * CLI-2826: the check block, the after-commit read and the in-transaction warn
 * read set `pgrst.db_schemas` only when splinter would not already read the
 * exposed schemas from it. Once set, a session keeps the placeholder as `''`
 * (known pitfall 2), so skipping the set keeps a pooled session clean.
 * Uses `public`, so it owns its cluster.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type pg from "pg";
import {
  RULES,
  buildInTransactionWarnRead,
  parseInTransactionWarnRead,
  resolvePolicy,
} from "../src/index.ts";
import { applyMigrationLikeCli, readFindings } from "./cli-executor.ts";
import {
  SUPABASE_IMAGES,
  type SupabasePostgres,
  startSupabasePostgres,
} from "./supabase-postgres.ts";

const majors = (process.env["PGCHECKS_PG"] ?? "17,15").split(
  ",",
) as (keyof typeof SUPABASE_IMAGES)[];

const only = (severity: "warn" | "error") =>
  resolvePolicy(
    Object.fromEntries(
      RULES.map((rule) => [
        rule,
        rule === "rls_disabled_in_public" ? severity : "off",
      ]),
    ),
  );

const dbSchemas = async (client: pg.Client) =>
  (
    await client.query(
      "select pg_catalog.current_setting('pgrst.db_schemas', true) as v",
    )
  ).rows[0].v as string | null;

describe.each(majors)("supabase/postgres %s", (major) => {
  let db: SupabasePostgres;
  let seq = 0;
  const open: pg.Client[] = [];

  beforeAll(async () => {
    db = await startSupabasePostgres(SUPABASE_IMAGES[major]);
    const admin = await db.connect("supabase_admin");
    try {
      await admin.query(`create table public.t (id int primary key);
        grant select on public.t to anon, authenticated;
        create schema app;
        grant usage on schema app to anon, authenticated;
        create table app.a (id int primary key);
        grant select on app.a to anon, authenticated;`);
    } finally {
      await admin.end();
    }
  }, 240_000);

  afterAll(async () => {
    await Promise.all(open.map((c) => c.end().catch(() => {})));
    await db?.stop();
  });

  const fresh = async () => {
    const client = await db.connect("postgres");
    open.push(client);
    return client;
  };

  const exposedTables = (
    findings: { schema: string | null; name: string | null }[],
  ) => findings.map((f) => `${f.schema}.${f.name}`).sort();

  /** `begin; <file>; <warn read> commit;` as one simple-query string, like pg-meta. */
  async function warnRead(
    client: pg.Client,
    exposedSchemas: readonly string[],
  ) {
    const results = (await client.query(
      `begin;\nselect 1;\n${buildInTransactionWarnRead(only("warn"), { exposedSchemas })}commit;`,
    )) as unknown as pg.QueryResult[];
    const result = parseInTransactionWarnRead(
      results.flatMap((r) => r.rows),
      only("warn"),
    );
    if (!("findings" in result)) throw new Error(result.readError);
    return result.findings;
  }

  const nextVersion = () => `${20260301000000 + ++seq}`;

  describe("fresh session, public only: never sets it, so it stays unset", () => {
    test("check block", async () => {
      const client = await fresh();
      const result = await applyMigrationLikeCli(
        client,
        {
          version: nextVersion(),
          name: "blocked",
          statements: ["create table public.u (id int primary key)"],
        },
        only("error"),
        { exposedSchemas: ["public"] },
      );
      expect(result.outcome).toBe("blocked");
      if (result.outcome !== "blocked" || result.check.kind !== "blocked")
        return;
      expect(exposedTables(result.check.errors)).toEqual([
        "public.t",
        "public.u",
      ]);
      expect(await dbSchemas(client)).toBeNull();
    });

    test("after-commit read", async () => {
      const client = await fresh();
      const findings = await readFindings(client, only("warn"), ["public"]);
      expect(exposedTables(findings)).toEqual(["public.t"]);
      expect(await dbSchemas(client)).toBeNull();
    });

    test("in-transaction warn read", async () => {
      const client = await fresh();
      expect(exposedTables(await warnRead(client, ["public"]))).toEqual([
        "public.t",
      ]);
      expect(await dbSchemas(client)).toBeNull();
    });
  });

  test("a leftover '' with public only is set, so findings are right", async () => {
    const client = await fresh();
    await client.query(
      "begin; select pg_catalog.set_config('pgrst.db_schemas', 'x', true); rollback;",
    );
    expect(await dbSchemas(client)).toBe("");
    expect(
      exposedTables(await readFindings(client, only("warn"), ["public"])),
    ).toEqual(["public.t"]);
    expect(exposedTables(await warnRead(client, ["public"]))).toEqual([
      "public.t",
    ]);
    expect(await dbSchemas(client)).toBe("");
  });

  test("an already-equal value is left as is and findings are right", async () => {
    const client = await fresh();
    await client.query("set pgrst.db_schemas = 'public,app'");
    expect(
      exposedTables(
        await readFindings(client, only("warn"), ["public", "app"]),
      ),
    ).toEqual(["app.a", "public.t"]);
    expect(exposedTables(await warnRead(client, ["public", "app"]))).toEqual([
      "app.a",
      "public.t",
    ]);
    expect(await dbSchemas(client)).toBe("public,app");
  });

  test("Data API off sets '' and exposure rules find nothing", async () => {
    const client = await fresh();
    expect(await readFindings(client, only("warn"), [])).toEqual([]);
    expect(await warnRead(client, [])).toEqual([]);
    const result = await applyMigrationLikeCli(
      client,
      {
        version: nextVersion(),
        name: "off",
        statements: ["create table public.v (id int primary key)"],
      },
      only("error"),
      { exposedSchemas: [] },
    );
    expect(result.outcome).toBe("applied");
    expect(await dbSchemas(client)).toBe("");
  });
});
