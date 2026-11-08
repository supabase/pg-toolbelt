/**
 * Spark source parity: `sparkFactBase(description)` must produce the same fact
 * ids, payloads and dependency edges the real extractor produces for the same
 * schema in Postgres, so the generic planner/renderer treat both alike. Roles,
 * ACLs and ownership are out of scope (Spark has no roles).
 *
 * Docker required.
 */
import { describe, expect, test } from "bun:test";
import type { FactBase } from "../src/core/fact.ts";
import { encodeId } from "../src/core/stable-id.ts";
import { extract } from "../src/extract/extract.ts";
import { loadSqlFiles } from "../src/frontends/load-sql-files.ts";
import { sparkFactBase } from "../src/integrations/spark/fact-base.ts";
import { exportSparkSchema } from "../src/integrations/spark/frontend.ts";
import {
  TODOS_DDL,
  todosDescription,
} from "../src/integrations/spark/todos.fixture.ts";
import { sharedCluster } from "./containers.ts";

const COMPARED_KINDS = new Set([
  "schema",
  "type",
  "table",
  "column",
  "default",
  "constraint",
  "index",
  "policy",
  "view",
  "comment",
]);

/** Facts and `depends` edges of the kinds Spark models. The stock `public`
 *  schema comment is a Postgres default Spark does not carry. */
function comparable(fb: FactBase) {
  const facts: Record<string, unknown> = {};
  for (const f of fb.facts()) {
    if (!COMPARED_KINDS.has(f.id.kind)) continue;
    if (f.id.kind === "comment" && f.id.target.kind === "schema") continue;
    facts[encodeId(f.id)] = f.payload;
  }
  const edges = fb.edges
    .filter((e) => e.kind === "depends")
    .map((e) => `${encodeId(e.from)} -> ${encodeId(e.to)}`)
    .filter((e) => !e.includes("role:"))
    .sort();
  return { facts, edges };
}

const AUTH_STUB = `create schema auth; create table auth.users (id uuid primary key);`;

describe("spark source parity with the Postgres extractor", () => {
  test("todos: same fact ids, payloads and dependency edges", async () => {
    const db = await (await sharedCluster()).createDb("spark_parity");
    try {
      await db.pool.query(TODOS_DDL);
      const real = comparable((await extract(db.pool)).factBase);
      const spark = comparable(sparkFactBase(todosDescription()));
      expect(spark.facts).toEqual(real.facts);
      expect(spark.edges).toEqual(real.edges);
    } finally {
      await db.drop();
    }
  }, 120_000);

  test("todos: exported SQL reloads into Postgres as the same facts", async () => {
    const db = await (await sharedCluster()).createDb("spark_export_rt");
    try {
      // Spark's managed `auth.users` is reference only, so the export omits it.
      const files = [
        { name: "000_auth_stub.sql", sql: AUTH_STUB },
        ...exportSparkSchema(todosDescription()),
      ];
      const loaded = await loadSqlFiles(files, db.pool);
      expect(comparable(loaded.factBase)).toEqual(
        comparable(sparkFactBase(todosDescription())),
      );
    } finally {
      await db.drop();
    }
  }, 120_000);
});
