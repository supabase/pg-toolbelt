/**
 * Retyping a column away from an enum casts through `text` (`text[]` for an
 * array column): PostgreSQL has no enum-to-enum cast, so a direct
 * `col::other_enum` fails with 42846. Pure rule/diff level — no DB.
 */
import { describe, expect, test } from "bun:test";
import {
  buildFactBase,
  type DependencyEdge,
  type Fact,
} from "../../core/fact.ts";
import type { StableId } from "../../core/stable-id.ts";
import { plan } from "../plan.ts";

const schemaId: StableId = { kind: "schema", name: "app" };
const schemaFact: Fact = { id: schemaId, payload: { owner: "test" } };
const tableId: StableId = { kind: "table", schema: "app", name: "t" };
const tableFact: Fact = {
  id: tableId,
  parent: schemaId,
  payload: { owner: "test", persistence: "p" },
};
const colId: StableId = {
  kind: "column",
  schema: "app",
  table: "t",
  name: "c",
};
const enumId = (name: string): StableId => ({
  kind: "type",
  schema: "app",
  name,
});
const enumFact = (name: string): Fact => ({
  id: enumId(name),
  parent: schemaId,
  payload: { owner: "test", variant: "enum", values: ["a", "b"] },
});
const colFact = (type: string): Fact => ({
  id: colId,
  parent: tableId,
  payload: {
    type,
    notNull: false,
    collation: null,
    generatedExpr: null,
    identity: null,
  },
});
const state = (
  colType: string,
  enumName: string | null,
): ReturnType<typeof buildFactBase> => {
  const facts = [
    schemaFact,
    tableFact,
    enumFact("status"),
    enumFact("widget_status"),
    colFact(colType),
  ];
  const edges: DependencyEdge[] =
    enumName === null
      ? []
      : [{ from: colId, to: enumId(enumName), kind: "depends" }];
  return buildFactBase(facts, edges);
};
const retype = (
  from: ReturnType<typeof buildFactBase>,
  to: ReturnType<typeof buildFactBase>,
) =>
  plan(from, to)
    .actions.map((a) => a.sql)
    .filter((s) => s.includes(" TYPE "));

describe("column type change from an enum", () => {
  test("enum → differently named enum casts through text", () => {
    expect(
      retype(
        state("app.status", "status"),
        state("app.widget_status", "widget_status"),
      ),
    ).toMatchInlineSnapshot(`
        [
          "ALTER TABLE "app"."t" ALTER COLUMN "c" TYPE app.widget_status USING "c"::text::app.widget_status",
        ]
      `);
  });

  test("enum[] → differently named enum[] casts through text[]", () => {
    expect(
      retype(
        state("app.status[]", "status"),
        state("app.widget_status[]", "widget_status"),
      ),
    ).toMatchInlineSnapshot(`
      [
        "ALTER TABLE "app"."t" ALTER COLUMN "c" TYPE app.widget_status[] USING "c"::text[]::app.widget_status[]",
      ]
    `);
  });

  test("enum → non-enum keeps the direct cast (honours a user-defined cast)", () => {
    expect(retype(state("app.status", "status"), state("integer", null)))
      .toMatchInlineSnapshot(`
      [
        "ALTER TABLE "app"."t" ALTER COLUMN "c" TYPE integer USING "c"::integer",
      ]
    `);
  });

  test("text → enum keeps the direct cast", () => {
    expect(
      retype(state("text", null), state("app.widget_status", "widget_status")),
    ).toMatchInlineSnapshot(`
        [
          "ALTER TABLE "app"."t" ALTER COLUMN "c" TYPE app.widget_status USING "c"::app.widget_status",
        ]
      `);
  });
});
