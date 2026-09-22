/**
 * Extraction must not flood the diagnostic stream with dangling edges to
 * built-in (system-schema) objects — those bury real user-facing warnings
 * (review P1). A schema whose views/functions reference built-ins (count(),
 * upper(), pg_catalog types) should produce ZERO system dangling_edge
 * diagnostics, while still emitting the real user→user dependency edges.
 *
 * The same rule covers catalog rows the engine models as an ATTRIBUTE rather
 * than a fact: PostgreSQL catalogs NOT NULL as a `pg_constraint` row
 * (`contype = 'n'`) — for domains since PG17, for table columns since PG18 —
 * while pg-delta keeps NOT NULL on the domain/column payload. Resolving such a
 * row as a dependency endpoint yields an edge to a fact that does not exist,
 * so extraction warns once per NOT NULL column (issue #483). The fixture below
 * is deliberately NOT NULL-heavy so that regression cannot come back.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { extract, type ExtractResult } from "../src/extract/extract.ts";
import { createTestDb, type TestDb } from "./containers.ts";

let db: TestDb;
let result: ExtractResult;

beforeAll(async () => {
  db = await createTestDb("diag-noise");
  await db.pool.query(`
    CREATE SCHEMA app;
    CREATE TABLE app.t (id integer PRIMARY KEY, name text);
    -- NOT NULL in every shape PostgreSQL catalogs it: implied by a PRIMARY KEY,
    -- declared inline, and added after the fact. On PG18 each one is a
    -- pg_constraint row (contype 'n') carrying a pg_depend edge to its column.
    CREATE TABLE app.nn (
      id integer PRIMARY KEY,
      label text NOT NULL,
      note text
    );
    ALTER TABLE app.nn ALTER COLUMN note SET NOT NULL;
    -- view + function leaning on built-in functions/types (pg_catalog)
    CREATE VIEW app.summary AS
      SELECT count(*) AS n, max(upper(name)) AS hi FROM app.t;
    CREATE FUNCTION app.label(x integer) RETURNS text
      LANGUAGE sql STABLE AS 'SELECT upper(''row'' || x::text)';
  `);
  result = await extract(db.pool);
}, 120_000);

afterAll(async () => {
  await db.drop();
});

describe("extraction diagnostic noise (P1)", () => {
  test("no dangling_edge diagnostics for built-in / system-schema objects", () => {
    const systemDangling = result.diagnostics.filter(
      (d) =>
        d.code === "dangling_edge" &&
        /pg_catalog|information_schema|pg_toast|pg_temp/.test(d.message),
    );
    expect(systemDangling).toHaveLength(0);
  });

  test("real user→user dependency edges are still emitted", () => {
    const depends = result.factBase.edges.filter((e) => e.kind === "depends");
    // the view depends on the table's columns; that edge must survive
    expect(depends.length).toBeGreaterThan(0);
  });

  test("no dangling_edge diagnostics for built-in (pg_*) owner roles", () => {
    // The `public` schema is owned by the built-in role `pg_database_owner`
    // (PG14+), which extraction never emits as a role fact — so an owner edge
    // to it would always dangle. pushOwnerEdge now skips built-in owners
    // (isBuiltinRoleName), killing the recurring `role:pg_database_owner`
    // dangling_edge warning.
    const builtinRoleDangling = result.diagnostics.filter(
      (d) =>
        d.code === "dangling_edge" &&
        ((d.subject?.kind === "role" && d.subject.name.startsWith("pg_")) ||
          /-\[owner\]-> role:pg_/.test(d.message)),
    );
    expect(builtinRoleDangling).toHaveLength(0);
  });

  test("no dangling_edge diagnostics for catalog NOT NULL rows (issue #483)", () => {
    // A dangling constraint -> column edge can only come from a pg_constraint
    // row the extractor does not turn into a fact. There are two such classes:
    // NOT NULL rows (`contype 'n'`, this test's subject) and inherited /
    // partition-child constraints (`conislocal = false`, which relations.ts
    // also skips and which still warn on every version — a separate,
    // pre-existing gap). This fixture deliberately contains NEITHER
    // inheritance nor partitions, so any hit here is a NOT NULL regression.
    // Matching the edge SHAPE rather than the `_not_null` naming convention
    // keeps the lock honest if PostgreSQL ever catalogs another attribute the
    // same way.
    const attributeDangling = result.diagnostics.filter(
      (d) =>
        d.code === "dangling_edge" &&
        /constraint:\S+ -\[depends\]-> column:/.test(d.message),
    );
    expect(attributeDangling).toEqual([]);
  });

  test("extraction of an ordinary user schema emits no diagnostics at all", () => {
    // The strongest form of the same rule: this fixture is entirely made of
    // objects the engine models, so a clean extract must be silent. Any new
    // diagnostic here is noise until proven otherwise.
    expect(result.diagnostics).toEqual([]);
  });
});
