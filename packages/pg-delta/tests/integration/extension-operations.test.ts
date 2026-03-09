import { describe, expect, test } from "bun:test";
import dedent from "dedent";
import { extractCatalog } from "../../src/core/catalog.model.ts";
import type { Change } from "../../src/core/change.types.ts";
import { createPlan } from "../../src/core/plan/create.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDbSupabaseIsolated } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`extension operations (pg${pgVersion})`, () => {
    test(
      "create extension",
      withDbSupabaseIsolated(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          testSql: `
          CREATE EXTENSION vector WITH SCHEMA extensions;
          CREATE TABLE test_table (vec extensions.vector);
        `,
          sortChangesCallback: (a, b) => {
            const priority = (change: Change) => {
              if (
                change.objectType === "extension" &&
                change.operation === "create" &&
                change.scope === "object"
              ) {
                return 0;
              }
              if (
                change.objectType === "table" &&
                change.operation === "create"
              ) {
                return 1;
              }
              if (
                change.objectType === "extension" &&
                change.operation === "create" &&
                change.scope === "comment"
              ) {
                return 2;
              }
              return 3;
            };
            return priority(a) - priority(b);
          },
        });
      }),
    );

    test(
      "extension with comment",
      withDbSupabaseIsolated(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA IF NOT EXISTS extensions;",
          testSql: dedent`
            CREATE EXTENSION vector WITH SCHEMA extensions;
            COMMENT ON EXTENSION vector IS 'Vector similarity search';
          `,
          sortChangesCallback: (a, b) => {
            const priority = (change: Change) => {
              if (
                change.objectType === "extension" &&
                change.operation === "create" &&
                change.scope === "object"
              ) {
                return 0;
              }
              if (
                change.objectType === "extension" &&
                change.operation === "create" &&
                change.scope === "comment"
              ) {
                return 1;
              }
              return 2;
            };
            return priority(a) - priority(b);
          },
        });
      }),
    );

    test(
      "preserves pgvector typmod dimensions in catalog extraction and diff SQL",
      withDbSupabaseIsolated(pgVersion, async (db) => {
        const setupSql = dedent`
          CREATE SCHEMA test_schema;
          CREATE EXTENSION IF NOT EXISTS vector SCHEMA test_schema;

          CREATE TABLE test_schema.embeddings (
            id serial PRIMARY KEY,
            title text NOT NULL,
            embedding test_schema.halfvec(384) NOT NULL
          );

          CREATE INDEX embeddings_hnsw_idx
            ON test_schema.embeddings
            USING hnsw (embedding test_schema.halfvec_l2_ops)
            WITH (m = 16, ef_construction = 64);
        `;

        await db.main.query(setupSql);
        await db.branch.query(setupSql);
        await db.branch.query(dedent`
          ALTER TABLE test_schema.embeddings
            ADD COLUMN embedding_v2 test_schema.vector(768);
        `);

        const branchCatalog = await extractCatalog(db.branch);
        const embeddings = Object.values(branchCatalog.tables).find(
          (table) =>
            table.schema === "test_schema" && table.name === "embeddings",
        );

        expect(embeddings).toBeDefined();
        expect(
          embeddings?.columns.find((column) => column.name === "embedding")
            ?.data_type_str,
        ).toContain("halfvec(384)");
        expect(
          embeddings?.columns.find((column) => column.name === "embedding_v2")
            ?.data_type_str,
        ).toContain("vector(768)");

        const planResult = await createPlan(db.main, db.branch);
        expect(planResult).not.toBeNull();
        expect(planResult?.plan.statements).toMatchInlineSnapshot(`
          [
            "ALTER TABLE test_schema.embeddings ADD COLUMN embedding_v2 test_schema.vector(768)",
          ]
        `);
      }),
    );
  });
}
