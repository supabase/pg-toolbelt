/**
 * The corpus seed-coverage gate must fail LOUDLY even inside an
 * EXPECTED_RED-pinned scenario: the pinned driver swallows a plain `Error`
 * ("red as pinned"), so a seed-coverage regression there would satisfy the pin
 * instead of failing the corpus. `enforceSeedCoverage` therefore throws a
 * distinct `SeedCoverageError`, which the pinned catch re-throws.
 *
 * Pure/unit: feed a synthetic ProofVerdict, no database.
 */
import { describe, expect, test } from "bun:test";
import type { ProofVerdict, SeedOutcome } from "../src/proof/prove.ts";
import { ActionShapeBudgetError } from "./action-shape-budgets.ts";
import {
  enforceSeedCoverage,
  runPinnedDirection,
  SeedCoverageError,
} from "./seed-coverage.ts";

function verdictWith(seedOutcomes: SeedOutcome[]): ProofVerdict {
  return {
    ok: true,
    driftDeltas: [],
    dataViolations: [],
    rewriteViolations: [],
    coverage: { tablesChecked: 0, tablesSkipped: [], perTable: [] },
    seedOutcomes,
  };
}

describe("enforceSeedCoverage error typing", () => {
  test("a `failed` seed outcome throws a SeedCoverageError (not a plain Error)", () => {
    const verdict = verdictWith([
      {
        table: { schema: "s", name: "boom" },
        status: "failed",
        reasonCode: "P0001",
        message: "seed blocked",
      },
    ]);
    let caught: unknown;
    try {
      enforceSeedCoverage("scenario-x", "forward", "scenario-x", verdict);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SeedCoverageError);
  });

  test("an unlisted class-23 skip throws a SeedCoverageError", () => {
    const verdict = verdictWith([
      {
        table: { schema: "s", name: "unlisted" },
        status: "skipped",
        reasonCode: "23502",
      },
    ]);
    expect(() =>
      enforceSeedCoverage("scenario-not-in-allowlist", "forward", "l", verdict),
    ).toThrow(SeedCoverageError);
  });

  test("an all-`seeded` verdict does not throw", () => {
    const verdict = verdictWith([
      { table: { schema: "s", name: "ok" }, status: "seeded" },
    ]);
    expect(() =>
      enforceSeedCoverage("scenario-y", "forward", "l", verdict),
    ).not.toThrow();
  });

  test("an allowlist entry becoming seedable is rejected as stale", () => {
    const verdict = verdictWith([
      { table: { schema: "test_schema", name: "foo" }, status: "seeded" },
    ]);
    expect(() =>
      enforceSeedCoverage(
        "trigger-operations--trigger-drop-before-function-drop",
        "forward",
        "l",
        verdict,
      ),
    ).toThrow(SeedCoverageError);
  });

  test("an observed allowlisted skip remains accepted", () => {
    const verdict = verdictWith([
      {
        table: { schema: "test_schema", name: "foo" },
        status: "skipped",
        reasonCode: "no_row",
      },
    ]);
    expect(() =>
      enforceSeedCoverage(
        "trigger-operations--trigger-drop-before-function-drop",
        "forward",
        "l",
        verdict,
      ),
    ).not.toThrow();
  });
});

describe("runPinnedDirection (EXPECTED_RED wrapper)", () => {
  test("a pin fails when the run fails for a reason other than the pinned one", async () => {
    const run = runPinnedDirection(
      "k:forward",
      async () => {
        throw new Error("apply failed at action 0: some other error");
      },
      "already exists",
    );
    expect(run).rejects.toThrow(
      'pinned in EXPECTED_RED to fail with "already exists"',
    );
    await runPinnedDirection(
      "k:forward",
      async () => {
        throw new Error('column "x" already exists');
      },
      "already exists",
    );
  });

  test("a RegExp pin must match the whole failure shape", async () => {
    const pin = /dependency cycle among[\s\S]*RENAME COLUMN "c"/;
    expect(
      runPinnedDirection(
        "k:forward",
        async () => {
          throw new Error('apply failed: RENAME COLUMN "c" TO "d"');
        },
        pin,
      ),
    ).rejects.toThrow("pinned in EXPECTED_RED to fail with /dependency cycle");
    await runPinnedDirection(
      "k:forward",
      async () => {
        throw new Error('dependency cycle among:\n RENAME COLUMN "c" TO "d"');
      },
      pin,
    );
  });

  test("autoSeed state changes are re-thrown instead of satisfying a red pin", async () => {
    const verdict = {
      ...verdictWith([
        { table: { schema: "s", name: "mutator" }, status: "seeded" },
      ]),
      ok: false,
      seedStateViolation: {
        expectedFingerprint: "expected",
        actualFingerprint: "mutated",
      },
    } as ProofVerdict;

    let caught: unknown;
    try {
      await runPinnedDirection("k:forward", async () => {
        enforceSeedCoverage("k", "forward", "k", verdict);
        throw new Error("ordinary proof failure");
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SeedCoverageError);
  });

  test("autoSeed side effects are re-thrown instead of satisfying a red pin", async () => {
    const verdict = {
      ...verdictWith([
        { table: { schema: "s", name: "mutator" }, status: "seeded" },
      ]),
      ok: false,
      dataViolations: [
        {
          table: { schema: "s", name: "victim" },
          before: 1,
          after: 0,
        },
      ],
      seedSideEffects: [
        {
          table: { schema: "s", name: "victim" },
          before: 1,
          after: 0,
        },
      ],
    } as ProofVerdict;

    let caught: unknown;
    try {
      await runPinnedDirection("k:forward", async () => {
        enforceSeedCoverage("k", "forward", "k", verdict);
        throw new Error("ordinary proof failure");
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SeedCoverageError);
  });

  test("a SeedCoverageError is re-thrown (never swallowed as red-as-pinned)", async () => {
    const boom = new SeedCoverageError("coverage violated");
    let caught: unknown;
    try {
      await runPinnedDirection("k:forward", async () => {
        throw boom;
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SeedCoverageError);
    expect(caught).toBe(boom);
  });

  test("an ActionShapeBudgetError is re-thrown (never swallowed as red-as-pinned)", async () => {
    const boom = new ActionShapeBudgetError("action shape violated");
    let caught: unknown;
    try {
      await runPinnedDirection("k:forward", async () => {
        throw boom;
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ActionShapeBudgetError);
    expect(caught).toBe(boom);
  });

  test("any other error resolves quietly (legitimately red as pinned)", async () => {
    // resolves without throwing — reaching the next line is the assertion.
    const result = await runPinnedDirection("k:forward", async () => {
      throw new Error("ordinary proof failure");
    });
    expect(result).toBeUndefined();
  });

  test("a passing run throws the pinned-but-now-passes error", async () => {
    let caught: unknown;
    try {
      await runPinnedDirection("k:forward", async () => {});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(
      /pinned in EXPECTED_RED but now PASSES/,
    );
  });
});
