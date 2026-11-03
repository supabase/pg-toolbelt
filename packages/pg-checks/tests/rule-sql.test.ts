/**
 * D27: each checked rule's SQL, run alone, returns exactly the rows the full
 * released splinter.sql returns for that rule.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type pg from "pg";
import { RULES, buildAfterCommitRead, resolvePolicy } from "../src/index.ts";
import { RULE_SQL } from "../src/vendor/splinter.ts";
import {
  SUPABASE_IMAGES,
  type SupabasePostgres,
  startSupabasePostgres,
} from "./supabase-postgres.ts";

const majors = (process.env["PGCHECKS_PG"] ?? "17,15").split(
  ",",
) as (keyof typeof SUPABASE_IMAGES)[];

const RELEASED = readFileSync(
  join(import.meta.dir, "..", "src", "vendor", "splinter.sql"),
  "utf8",
);

// One object per rule, all in `public` (exposed by default).
const FIXTURE = `
create table public.open_t (id int primary key, password text);
grant select on public.open_t to anon, authenticated;
create table public.locked (id int primary key);
alter table public.locked enable row level security;
create table public.half (id int primary key);
create policy half_p on public.half for select using (true);
create view public.v_definer as select id from public.locked;
grant select on public.v_definer to anon;
create table public.wide (id int primary key);
alter table public.wide enable row level security;
create policy wide_all on public.wide for update to authenticated using (true) with check (true);
create view public.v_users as select id, email from auth.users;
grant select on public.v_users to anon, authenticated;
create function public.f_mutable() returns int language sql as 'select 1';
create table public.meta (id int primary key);
alter table public.meta enable row level security;
create policy meta_p on public.meta for select to authenticated
  using ((current_setting('request.jwt.claims', true)::jsonb -> 'user_metadata' ->> 'role') = 'admin');
`;

const canonical = (rows: readonly unknown[]) =>
  rows.map((row) => JSON.stringify(row)).sort();

describe.each(majors)("supabase/postgres %s", (major) => {
  let db: SupabasePostgres;
  let client: pg.Client;

  beforeAll(async () => {
    db = await startSupabasePostgres(SUPABASE_IMAGES[major]);
    const admin = await db.connect("supabase_admin");
    try {
      await admin.query(FIXTURE);
    } finally {
      await admin.end();
    }
    client = await db.connect("postgres");
  }, 240_000);

  afterAll(async () => {
    await client?.end();
    await db?.stop();
  });

  /** The released file as shipped: header, preamble, full union. */
  async function releasedRows(): Promise<Record<string, unknown>[]> {
    const results = (await client.query(
      `begin;\n${RELEASED};\nrollback;`,
    )) as unknown as pg.QueryResult[];
    return results.flatMap((r) => (r.command === "SELECT" ? r.rows : []));
  }

  async function rowsOf(sql: string): Promise<Record<string, unknown>[]> {
    await client.query("begin");
    try {
      await client.query("set local search_path = ''");
      return (await client.query(sql)).rows;
    } finally {
      await client.query("rollback");
    }
  }

  test("each rule's SQL alone yields the released query's rows for that rule", async () => {
    const released = await releasedRows();
    for (const rule of RULES) {
      const expected = released.filter((row) => row["name"] === rule);
      expect(expected.length, `${rule} has a fixture finding`).toBeGreaterThan(
        0,
      );
      const alone = await rowsOf(RULE_SQL[rule] ?? "");
      expect(canonical(alone), rule).toEqual(canonical(expected));
    }
  });

  test("the read built from the selected rules equals the released query filtered by name", async () => {
    const released = await releasedRows();
    const read = buildAfterCommitRead(resolvePolicy({}), {
      exposedSchemas: ["public"],
    });
    const results = (await client.query(
      read.sql,
    )) as unknown as pg.QueryResult[];
    const rows = results[read.resultIndex]?.rows ?? [];
    expect(canonical(rows)).toEqual(
      canonical(
        released.filter((row) =>
          (RULES as readonly unknown[]).includes(row["name"]),
        ),
      ),
    );
  });
});
