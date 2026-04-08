/**
 * Integration tests for index dependency on extensions.
 *
 * Verifies that CREATE EXTENSION is ordered before CREATE INDEX when the
 * index uses an operator class provided by that extension (e.g. gin_trgm_ops
 * from pg_trgm).
 */

import { describe, expect, test } from "bun:test";
import { createPlan } from "../../src/core/plan/create.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDb } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`index extension dependencies (pg${pgVersion})`, () => {
    test(
      "CREATE EXTENSION pg_trgm ordered before CREATE INDEX using gin_trgm_ops",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          testSql: `
            CREATE EXTENSION pg_trgm;
            CREATE TABLE public.documents (
              id integer,
              content text
            );
            CREATE INDEX idx_documents_content_trgm
              ON public.documents USING gin (content gin_trgm_ops);
          `,
        });
      }),
    );

    test(
      "extension index with cross-schema dependency",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          testSql: `
            CREATE EXTENSION pg_trgm WITH SCHEMA public;
            CREATE SCHEMA app;
            CREATE TABLE app.search_items (
              id integer,
              name text
            );
            CREATE INDEX idx_search_items_name_trgm
              ON app.search_items USING gin (name public.gin_trgm_ops);
          `,
        });
      }),
    );

    test(
      "plan from null source orders extension before index",
      withDb(pgVersion, async (db) => {
        await db.branch.query(`
          CREATE EXTENSION pg_trgm;
          CREATE TABLE public.items (id integer, label text);
          CREATE INDEX idx_items_label_trgm ON public.items USING gin (label gin_trgm_ops);
        `);

        const result = await createPlan(null, db.branch);
        expect(result).not.toBeNull();
        if (!result) return;

        const statements = result.plan.statements;
        const extIdx = statements.findIndex((s) =>
          s.includes("CREATE EXTENSION") && s.includes("pg_trgm"),
        );
        const indexIdx = statements.findIndex((s) =>
          s.includes("idx_items_label_trgm"),
        );

        expect(extIdx).toBeGreaterThanOrEqual(0);
        expect(indexIdx).toBeGreaterThanOrEqual(0);
        expect(extIdx).toBeLessThan(indexIdx);
      }),
    );
  });
}
