import { describe, expect, test } from "bun:test";
import { normalizePlan } from "./normalize.ts";
import type { SerializedPlan } from "./types.ts";

describe("normalizePlan", () => {
  test("hydrates legacy flattened plans into execution units", () => {
    const plan: SerializedPlan = {
      version: 1,
      source: { fingerprint: "source" },
      target: { fingerprint: "target" },
      statements: [
        "SET ROLE app_owner",
        "CREATE TABLE public.users (id integer PRIMARY KEY)",
      ],
    };

    expect(normalizePlan(plan)).toMatchInlineSnapshot(`
      {
        "sessionStatements": [
          "SET ROLE app_owner",
        ],
        "source": {
          "fingerprint": "source",
        },
        "statements": [
          "SET ROLE app_owner",
          "CREATE TABLE public.users (id integer PRIMARY KEY)",
        ],
        "target": {
          "fingerprint": "target",
        },
        "units": [
          {
            "id": "unit_001",
            "name": "schema_changes",
            "reason": "default",
            "statements": [
              {
                "id": "stmt_0001",
                "producesCommittedEffects": [],
                "requiresCommittedEffects": [],
                "sql": "CREATE TABLE public.users (id integer PRIMARY KEY)",
              },
            ],
            "transactionMode": "transactional",
          },
        ],
        "version": 1,
      }
    `);
  });
});
