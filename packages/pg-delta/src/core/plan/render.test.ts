import { describe, expect, test } from "bun:test";
import { renderPlanFiles, renderPlanSql } from "./render.ts";
import type { Plan } from "./types.ts";

describe("plan rendering", () => {
  test("renders single SQL scripts with unit boundary comments", () => {
    expect(renderPlanSql(createPlan())).toMatchInlineSnapshot(`
      "-- Migration unit 1: enum_values
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
        "001_enum_values.sql",
        "002_after_enum_values.sql",
      ]
    `);

    expect(files[0].sql).toMatchInlineSnapshot(`
      "-- Migration unit 1: enum_values
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
        id: "unit_001",
        name: "non_transactional",
        transactionMode: "none",
        reason: "non_transactional",
        statements: [
          {
            id: "stmt_0001",
            sql: "CREATE INDEX CONCURRENTLY users_email_idx ON public.users (email)",
            requiresCommittedEffects: [],
            producesCommittedEffects: [],
          },
        ],
      },
    ];
    plan.statements = [
      "SET ROLE app_owner",
      "CREATE INDEX CONCURRENTLY users_email_idx ON public.users (email)",
    ];

    expect(renderPlanSql(plan)).toMatchInlineSnapshot(`
      "-- Migration unit 1: non_transactional
      -- Transaction mode: none
      -- Boundary reason: non_transactional

      SET ROLE app_owner;

      CREATE INDEX CONCURRENTLY users_email_idx ON public.users (email);"
    `);
  });
});

function createPlan(): Plan {
  return {
    version: 2,
    source: { fingerprint: "source" },
    target: { fingerprint: "target" },
    role: "app_owner",
    sessionStatements: ["SET ROLE app_owner"],
    statements: [
      "SET ROLE app_owner",
      "ALTER TYPE public.user_role ADD VALUE 'store'",
      "ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'store'::public.user_role",
    ],
    units: [
      {
        id: "unit_001",
        name: "enum_values",
        transactionMode: "transactional",
        reason: "default",
        statements: [
          {
            id: "stmt_0001",
            sql: "ALTER TYPE public.user_role ADD VALUE 'store'",
            changeId: "change-1",
            requiresCommittedEffects: [],
            producesCommittedEffects: [
              {
                kind: "enum_value_committed",
                enumType: {
                  schema: "public",
                  name: "user_role",
                  stableId: "type:public.user_role",
                },
                label: "store",
              },
            ],
          },
        ],
      },
      {
        id: "unit_002",
        name: "after_enum_values",
        transactionMode: "transactional",
        reason: "enum_value_visibility",
        statements: [
          {
            id: "stmt_0002",
            sql: "ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'store'::public.user_role",
            changeId: "change-2",
            requiresCommittedEffects: [
              {
                kind: "enum_value_committed",
                enumType: {
                  schema: "public",
                  name: "user_role",
                  stableId: "type:public.user_role",
                },
                label: "store",
              },
            ],
            producesCommittedEffects: [],
          },
        ],
      },
    ],
    risk: { level: "safe" },
  };
}
