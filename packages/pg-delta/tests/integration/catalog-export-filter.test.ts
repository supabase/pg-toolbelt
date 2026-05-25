import { describe, expect, test } from "bun:test";
import { extractCatalog } from "../../src/core/catalog.model.ts";
import { filterCatalog } from "../../src/core/catalog.filter.ts";
import {
  deserializeCatalog,
  serializeCatalog,
  stringifyCatalogSnapshot,
} from "../../src/core/catalog.snapshot.ts";
import { createPlan } from "../../src/core/plan/create.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDb } from "../utils.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`catalog-export --filter (pg${pgVersion})`, () => {
    test(
      "filterCatalog keeps only objects matching the filter",
      withDb(pgVersion, async (db) => {
        await db.branch.query(`
          CREATE SCHEMA app;
          CREATE TABLE app.users (id serial PRIMARY KEY, name text NOT NULL);
          CREATE TABLE app.posts (id serial PRIMARY KEY, title text NOT NULL);
          CREATE SCHEMA other;
          CREATE TABLE other.config (key text PRIMARY KEY);
        `);

        const full = await extractCatalog(db.branch);
        const scoped = await filterCatalog(full, { "*/schema": "app" });

        expect(Object.keys(scoped.schemas).sort()).toEqual(["schema:app"]);
        expect(Object.keys(scoped.tables).sort()).toEqual([
          "table:app.posts",
          "table:app.users",
        ]);
        expect(Object.keys(scoped.tables)).not.toContain("table:other.config");
        expect(Object.keys(scoped.schemas)).not.toContain("schema:other");
        expect(Object.keys(scoped.schemas)).not.toContain("schema:public");
      }),
    );

    test(
      "filterCatalog drops pg_depend edges that touch pruned objects",
      withDb(pgVersion, async (db) => {
        await db.branch.query(`
          CREATE SCHEMA app;
          CREATE TABLE app.users (id serial PRIMARY KEY);
          CREATE SCHEMA other;
          CREATE TABLE other.t (id serial PRIMARY KEY);
        `);

        const full = await extractCatalog(db.branch);
        const scoped = await filterCatalog(full, { "*/schema": "app" });

        for (const dep of scoped.depends) {
          expect(dep.dependent_stable_id).not.toContain("other");
          expect(dep.referenced_stable_id).not.toContain("other");
        }
      }),
    );

    test(
      "round-trip: filtered snapshot diffs to zero against live source with same filter",
      withDb(pgVersion, async (db) => {
        await db.branch.query(`
          CREATE SCHEMA app;
          CREATE TABLE app.users (id serial PRIMARY KEY, name text NOT NULL);
          CREATE SCHEMA other;
          CREATE TABLE other.config (key text PRIMARY KEY);
        `);

        const full = await extractCatalog(db.branch);
        const filter = { "*/schema": "app" };
        const scoped = await filterCatalog(full, filter);

        // Reconstruct via the snapshot serializer to prove the prune survives
        // a real save→load cycle (which is what catalog-export does).
        const roundTripped = deserializeCatalog(
          JSON.parse(stringifyCatalogSnapshot(serializeCatalog(scoped))),
        );

        const plan = await createPlan(db.branch, roundTripped, { filter });
        expect(plan).toBeNull();
      }),
    );

    test(
      "schema filter keeps schema even when its owner role is filtered out",
      withDb(pgVersion, async (db) => {
        // Reproduces a class of bug surfaced by Supabase images: the kept
        // schema's CREATE change `requires` an owner role; if filterCatalog
        // ran cascadeExclusions, the filter would drop the role change,
        // cascade would propagate to the schema, and the snapshot would
        // come out empty. The filter must keep the schema (and its objects)
        // even when out-of-scope owners exist in the live catalog.
        await db.branch.query(`
          CREATE ROLE app_owner;
          CREATE SCHEMA realtime AUTHORIZATION app_owner;
          CREATE TABLE realtime.subscription (id serial PRIMARY KEY);
        `);

        const full = await extractCatalog(db.branch);
        const scoped = await filterCatalog(full, { "*/schema": "realtime" });

        expect(Object.keys(scoped.schemas)).toContain("schema:realtime");
        expect(Object.keys(scoped.tables)).toContain(
          "table:realtime.subscription",
        );
        // The owner role itself is filtered out (no `role/schema` to match).
        expect(Object.keys(scoped.roles)).not.toContain("role:app_owner");
      }),
    );

    test(
      "round-trip matches realtime usage: schema filter survives plan",
      withDb(pgVersion, async (db) => {
        // Mirrors the Realtime baseline workflow: snapshot a 'kitchen sink'
        // database scoped to one schema, then drift-check tenant against it
        // using the same filter at plan time.
        await db.branch.query(`
          CREATE SCHEMA realtime;
          CREATE TABLE realtime.schema_migrations (
            version bigint PRIMARY KEY,
            inserted_at timestamp
          );
          CREATE TABLE realtime.subscription (
            id bigserial PRIMARY KEY,
            entity regclass NOT NULL,
            filters jsonb DEFAULT '[]'::jsonb
          );
          CREATE SCHEMA auth;
          CREATE TABLE auth.users (id uuid PRIMARY KEY);
          CREATE TABLE auth.sessions (id uuid PRIMARY KEY);
        `);

        const full = await extractCatalog(db.branch);
        const filter = { "*/schema": "realtime" };
        const scoped = await filterCatalog(full, filter);

        expect(Object.keys(scoped.schemas)).toContain("schema:realtime");
        expect(Object.keys(scoped.schemas)).not.toContain("schema:auth");
        expect(Object.keys(scoped.tables)).toContain(
          "table:realtime.schema_migrations",
        );
        expect(Object.keys(scoped.tables)).not.toContain("table:auth.users");

        const snapshot = deserializeCatalog(
          JSON.parse(stringifyCatalogSnapshot(serializeCatalog(scoped))),
        );
        const plan = await createPlan(db.branch, snapshot, { filter });
        expect(plan).toBeNull();
      }),
    );
  });
}
