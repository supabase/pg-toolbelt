/**
 * Shadow loader transactional robustness (hardening Item 6 / review #5):
 * each file applies inside an explicit transaction, so a mid-file failure
 * leaves no partial state and the file retries cleanly; a non-transactional
 * statement (CREATE INDEX CONCURRENTLY) still loads via a raw fallback.
 */
import { describe, expect, test } from "bun:test";
import { loadSqlFiles } from "../src/frontends/load-sql-files.ts";
import { createTestDb } from "./containers.ts";

describe("loadSqlFiles — per-file transactional apply", () => {
  test("a file that fails mid-way leaves no partial state and retries cleanly", async () => {
    const shadow = await createTestDb("shadow_atomic");
    try {
      // 1_a.sql: statement 1 (CREATE TABLE a) succeeds, statement 2 references
      //   b which does not exist yet → the whole file must roll back so that a
      //   is NOT created. Round 2 (after b loads) retries 1_a; if a had leaked
      //   from round 1, the retry would fail with "relation a already exists".
      const result = await loadSqlFiles(
        [
          {
            name: "1_a.sql",
            sql: `CREATE TABLE public.a (id integer PRIMARY KEY);
                  CREATE VIEW public.va AS SELECT id FROM public.b;`,
          },
          {
            name: "2_b.sql",
            sql: `CREATE TABLE public.b (id integer PRIMARY KEY);`,
          },
        ],
        shadow.pool,
      );
      expect(result.rounds).toBeGreaterThan(1);
      expect(
        result.factBase.has({ kind: "table", schema: "public", name: "a" }),
      ).toBe(true);
      expect(
        result.factBase.has({ kind: "view", schema: "public", name: "va" }),
      ).toBe(true);
      expect(
        result.factBase.has({ kind: "table", schema: "public", name: "b" }),
      ).toBe(true);
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  test("a CREATE INDEX CONCURRENTLY file loads via the raw fallback", async () => {
    const shadow = await createTestDb("shadow_concurrently");
    try {
      const result = await loadSqlFiles(
        [
          {
            name: "0_table.sql",
            sql: `CREATE TABLE public.t (id integer PRIMARY KEY, v integer);`,
          },
          {
            name: "1_index.sql",
            sql: `CREATE INDEX CONCURRENTLY t_v_idx ON public.t (v);`,
          },
        ],
        shadow.pool,
      );
      expect(
        result.factBase.has({
          kind: "index",
          schema: "public",
          name: "t_v_idx",
        }),
      ).toBe(true);
    } finally {
      await shadow.drop();
    }
  }, 60_000);
});
