import { describe, expect, test } from "bun:test";
import { normalizePlan } from "./normalize.ts";
import type { SerializedPlan } from "./types.ts";

describe("normalizePlan", () => {
  test("hydrates legacy v1 plans into a single transactional unit", () => {
    const legacy: SerializedPlan = {
      version: 1,
      source: { fingerprint: "source" },
      target: { fingerprint: "target" },
      role: "app_owner",
      statements: [
        'SET ROLE "app_owner"',
        "CREATE TABLE public.users (id integer)",
        "CREATE INDEX users_id_idx ON public.users (id)",
      ],
    };

    const plan = normalizePlan(legacy);

    expect(plan.sessionStatements).toEqual(['SET ROLE "app_owner"']);
    expect(plan.units).toMatchInlineSnapshot(`
      [
        {
          "reason": "default",
          "statements": [
            "CREATE TABLE public.users (id integer)",
            "CREATE INDEX users_id_idx ON public.users (id)",
          ],
          "transactionMode": "transactional",
        },
      ]
    `);
    expect("statements" in plan).toBe(false);
  });

  test("hydrates legacy v1 plans with only SET statements into zero units", () => {
    const legacy: SerializedPlan = {
      version: 1,
      source: { fingerprint: "source" },
      target: { fingerprint: "target" },
      statements: ['SET ROLE "app_owner"'],
    };

    const plan = normalizePlan(legacy);
    expect(plan.units).toEqual([]);
    expect(plan.sessionStatements).toEqual(['SET ROLE "app_owner"']);
  });

  test("passes v2 plans through and defaults sessionStatements", () => {
    const units = [
      {
        transactionMode: "transactional" as const,
        reason: "default" as const,
        statements: ["CREATE TABLE public.users (id integer)"],
      },
    ];
    const v2: SerializedPlan = {
      version: 2,
      source: { fingerprint: "source" },
      target: { fingerprint: "target" },
      units,
    };

    const plan = normalizePlan(v2);
    expect(plan.units).toEqual(units);
    expect(plan.sessionStatements).toEqual([]);
  });
});
