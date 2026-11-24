import { describe, expect, test } from "bun:test";
import { MIN_ROUNDS } from "./protocol.ts";
import { nextStep } from "./schedule.ts";

const quiet = {
  restartEvery: 2,
  elapsedMs: 0,
  budgetMs: 150_000,
  slowestRoundMs: 25_000,
  slowestRestartMs: 22_000,
};

describe("benchmark round schedule", () => {
  test("replaces the workers every `restartEvery` rounds, not before the first", () => {
    const steps = [0, 1, 2, 3, 4].map((round) => nextStep({ ...quiet, round }));
    expect(steps).toEqual(["sample", "sample", "restart", "sample", "restart"]);
  });

  test("counts the restart against the time budget", () => {
    // 110 s in: a plain round (25 s) fits the 150 s budget, a restart plus a
    // round (47 s) does not.
    const late = { ...quiet, elapsedMs: 110_000 };
    expect(nextStep({ ...late, round: 3 })).toBe("sample");
    expect(nextStep({ ...late, round: 4 })).toBe("stop");
  });

  test("always completes the minimum number of rounds", () => {
    const overrun = { ...quiet, restartEvery: 1, elapsedMs: 10 * 150_000 };
    for (let round = 1; round < MIN_ROUNDS; round++) {
      expect(nextStep({ ...overrun, round })).toBe("restart");
    }
    expect(nextStep({ ...overrun, round: MIN_ROUNDS })).toBe("stop");
  });
});
