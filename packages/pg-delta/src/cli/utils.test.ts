import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { Plan } from "../core/plan/types.ts";
import { deserializeCatalogSnapshotEffect, validatePlanRisk } from "./utils.ts";

describe("validatePlanRisk", () => {
  test("returns a specific message when risk metadata is missing", () => {
    const plan = { statements: ["SELECT 1"] } as Plan;

    expect(validatePlanRisk(plan, false)).toEqual({
      valid: false,
      exitCode: 1,
      message:
        "Plan is missing risk metadata. Regenerate the plan with the current pgdelta or re-run with --unsafe to apply anyway.",
    });
  });

  test("returns the unsafe guidance for data-loss plans", () => {
    const plan = {
      statements: ["DROP TABLE users"],
      risk: { level: "data_loss", statements: ["DROP TABLE users"] },
    } as Plan;

    expect(validatePlanRisk(plan, false)).toEqual({
      valid: false,
      exitCode: 1,
      message:
        "Data-loss operations detected. Re-run with --unsafe to allow applying this plan.",
      warning: {
        title: "Data-loss operations detected:",
        statements: ["DROP TABLE users"],
        suggestion: "Use `--unsafe` to allow applying these operations.",
      },
    });
  });

  test("accepts safe plans without warnings", () => {
    const plan = {
      source: { fingerprint: "from" },
      target: { fingerprint: "to" },
      version: 1,
      statements: ["SELECT 1"],
      risk: { level: "safe", statements: [] },
    } as Plan;

    expect(validatePlanRisk(plan, false)).toEqual({ valid: true });
  });
});

describe("deserializeCatalogSnapshotEffect", () => {
  test("maps malformed catalog snapshots into CliExitError", async () => {
    const result = await deserializeCatalogSnapshotEffect({} as never).pipe(
      Effect.result,
      Effect.runPromise,
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("CliExitError");
      expect(result.failure.message).toContain("Error deserializing catalog");
    }
  });
});
