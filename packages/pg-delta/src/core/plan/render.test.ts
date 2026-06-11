import { describe, expect, test } from "bun:test";
import {
  flattenPlanStatements,
  renderPlanFiles,
  renderPlanSql,
} from "./render.ts";
import type { Plan } from "./types.ts";

describe("plan rendering", () => {
  test("renders single SQL scripts with unit boundary comments", () => {
    expect(renderPlanSql(createPlan())).toMatchInlineSnapshot(`
      "-- Migration unit 1: schema_changes
      -- Transaction mode: transactional
      -- Boundary reason: default

      SET ROLE app_owner;

      BEGIN;

      ALTER TYPE public.user_role ADD VALUE 'store';

      COMMIT;

      -- Migration unit 2: after_enum_values
      -- Transaction mode: transactional
      -- Boundary reason: enum_value_visibility

      SET ROLE app_owner;

      BEGIN;

      ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'store'::public.user_role;

      COMMIT;"
    `);
  });

  test("renders numbered migration files from units", () => {
    const files = renderPlanFiles(createPlan());

    expect(files.map((file) => file.path)).toMatchInlineSnapshot(`
      [
        "001_schema_changes.sql",
        "002_after_enum_values.sql",
      ]
    `);

    expect(files[0].sql).toMatchInlineSnapshot(`
      "-- Migration unit 1: schema_changes
      -- Transaction mode: transactional
      -- Boundary reason: default

      SET ROLE app_owner;

      BEGIN;

      ALTER TYPE public.user_role ADD VALUE 'store';

      COMMIT;"
    `);

    expect(files[1].sql).toMatchInlineSnapshot(`
      "-- Migration unit 2: after_enum_values
      -- Transaction mode: transactional
      -- Boundary reason: enum_value_visibility

      SET ROLE app_owner;

      BEGIN;

      ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'store'::public.user_role;

      COMMIT;"
    `);
  });

  test("renders non-transactional units without transaction wrappers", () => {
    const plan = createPlan();
    plan.units = [
      {
        transactionMode: "none",
        reason: "non_transactional",
        statements: [
          "CREATE INDEX CONCURRENTLY users_email_idx ON public.users (email)",
        ],
      },
    ];

    expect(renderPlanSql(plan)).toMatchInlineSnapshot(`
      "-- Migration unit 1: non_transactional
      -- Transaction mode: none
      -- Boundary reason: non_transactional
      -- Run statement-by-statement (psql does this; do not use psql -1 or
      -- send this script as a single multi-statement query string).

      SET ROLE app_owner;

      CREATE INDEX CONCURRENTLY users_email_idx ON public.users (email);"
    `);
  });

  test("flattenPlanStatements includes session statements", () => {
    expect(flattenPlanStatements(createPlan())).toEqual([
      "SET ROLE app_owner",
      "ALTER TYPE public.user_role ADD VALUE 'store'",
      "ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'store'::public.user_role",
    ]);
  });
});

function createPlan(): Plan {
  return {
    version: 2,
    source: { fingerprint: "source" },
    target: { fingerprint: "target" },
    role: "app_owner",
    sessionStatements: ["SET ROLE app_owner"],
    units: [
      {
        transactionMode: "transactional",
        reason: "default",
        statements: ["ALTER TYPE public.user_role ADD VALUE 'store'"],
      },
      {
        transactionMode: "transactional",
        reason: "enum_value_visibility",
        statements: [
          "ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'store'::public.user_role",
        ],
      },
    ],
    risk: { level: "safe" },
  };
}
