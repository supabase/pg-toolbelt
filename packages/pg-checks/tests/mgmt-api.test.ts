/**
 * D28 through a real pg-meta in front of supabase/postgres 17: the migration, the
 * check, the history insert and the warn read in one `/query` string, with the
 * findings read before `commit`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type pg from "pg";
import {
  RULES,
  buildCheckBlock,
  buildInTransactionWarnRead,
  parseInTransactionWarnRead,
  resolvePolicy,
} from "../src/index.ts";
import {
  INIT_HISTORY,
  type PgMetaStack,
  applyAndTrack,
  startPgMetaStack,
} from "./mgmt-api.ts";
import { SUPABASE_IMAGES } from "./supabase-postgres.ts";

const majors = (process.env["PGCHECKS_PG"] ?? "17,15").split(",");

describe.skipIf(!majors.includes("17"))(
  "pg-meta + supabase/postgres 17",
  () => {
    let stack: PgMetaStack;
    let client: pg.Client;
    let seq = 0;

    beforeAll(async () => {
      stack = await startPgMetaStack(SUPABASE_IMAGES["17"]);
      client = await stack.db.connect("supabase_admin");
      expect((await stack.query(INIT_HISTORY)).status).toBe(200);
    }, 240_000);

    afterAll(async () => {
      await client?.end();
      await stack?.stop();
    });

    /** An exposed schema like `public`, its only exposed schema, and a fresh version. */
    async function fixture() {
      seq += 1;
      const schema = `m${seq}`;
      await client.query(`create schema ${schema};
      grant usage on schema ${schema} to anon, authenticated;
      alter default privileges in schema ${schema} grant select on tables to anon, authenticated;`);
      return {
        schema,
        version: `${20260201000000 + seq}`,
        exposed: { exposedSchemas: [schema] },
      };
    }

    const state = async (schema: string, version: string) =>
      (
        await client.query(
          `select pg_catalog.to_regclass($1) is not null as t,
          (select count(*)::int from supabase_migrations.schema_migrations where version = $2) as history`,
          [`${schema}.t`, version],
        )
      ).rows[0] as { t: boolean; history: number };

    const rowsOf = (body: unknown) => (Array.isArray(body) ? body : []);

    test("findings come back from the read before commit; migration and history committed", async () => {
      const { schema, version, exposed } = await fixture();
      const policy = resolvePolicy({});
      const file = `create table ${schema}.t (id int primary key);
create function ${schema}.f() returns int language sql as 'select 1'`;
      const response = await stack.query(
        applyAndTrack(file, version, {
          warnRead: buildInTransactionWarnRead(policy, exposed),
        }),
      );
      expect(response.status).toBe(200);
      const result = parseInTransactionWarnRead(rowsOf(response.body), policy);
      expect("findings" in result).toBe(true);
      if (!("findings" in result)) return;
      expect(
        result.findings
          .filter((f) => f.schema === schema)
          .map((f) => [f.rule, f.severity, f.name]),
      ).toEqual([
        ["rls_disabled_in_public", "warn", "t"],
        ["function_search_path_mutable", "warn", "f"],
      ]);
      expect(await state(schema, version)).toEqual({ t: true, history: 1 });
    });

    test("a read over its timeout still returns 200 with a read error, and the migration commits", async () => {
      const { schema, version, exposed } = await fixture();
      const policy = resolvePolicy({});
      const response = await stack.query(
        applyAndTrack(
          `create table ${schema}.t (id int primary key)`,
          version,
          {
            warnRead: buildInTransactionWarnRead(policy, {
              ...exposed,
              timeoutMs: 1,
            }),
          },
        ),
      );
      expect(response.status).toBe(200);
      const result = parseInTransactionWarnRead(rowsOf(response.body), policy);
      expect(result).toEqual({
        readError: "57014: canceling statement due to statement timeout",
      });
      expect(await state(schema, version)).toEqual({ t: true, history: 1 });
    });

    test("an SB001 block at error returns 400 and commits nothing", async () => {
      const { schema, version, exposed } = await fixture();
      const policy = resolvePolicy({ rls_disabled_in_public: "error" });
      const response = await stack.query(
        applyAndTrack(
          `create table ${schema}.t (id int primary key)`,
          version,
          {
            check: buildCheckBlock(policy, exposed),
            warnRead: buildInTransactionWarnRead(policy, exposed),
          },
        ),
      );
      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toContain("SB001");
      expect(await state(schema, version)).toEqual({ t: false, history: 0 });
    });

    test("zero findings returns the sentinel row with no findings, not the file's own rows", async () => {
      const { schema, version, exposed } = await fixture();
      // Only the exposure-scoped rules: the others see every schema, including
      // objects earlier tests left behind.
      const scoped = new Set([
        "rls_disabled_in_public",
        "security_definer_view",
        "sensitive_columns_exposed",
        "auth_users_exposed",
      ]);
      const policy = resolvePolicy(
        Object.fromEntries(
          RULES.map((rule) => [rule, scoped.has(rule) ? "warn" : "off"]),
        ),
      );
      const response = await stack.query(
        applyAndTrack(
          `create table ${schema}.t (id int primary key);
alter table ${schema}.t enable row level security;
select 42 as answer`,
          version,
          { warnRead: buildInTransactionWarnRead(policy, exposed) },
        ),
      );
      expect(response.status).toBe(200);
      const rows = rowsOf(response.body) as Record<string, string>[];
      expect(rows.map((row) => Object.keys(row))).toEqual([["sbc_findings"]]);
      expect(JSON.parse(rows[0]?.["sbc_findings"] ?? "null")).toEqual({
        findings: [],
      });
      expect(parseInTransactionWarnRead(rowsOf(response.body), policy)).toEqual(
        {
          findings: [],
        },
      );
      expect(await state(schema, version)).toEqual({ t: true, history: 1 });
    });
  },
);
