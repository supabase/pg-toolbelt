import { describe, expect, test } from "bun:test";
import { compare, failures, gateFails } from "./compare.ts";
import type { BenchResults } from "./run.ts";
import type { WorkerOutput } from "./worker.ts";

/** One round per entry: [base ms, head ms] for scenario "s", with fixed I/O
 *  unless overridden. */
function results(
  rounds: [number, number][],
  io: { base?: [number, number]; head?: [number, number] } = {},
): BenchResults {
  const out = (ms: number, [roundTrips, bytes] = [10, 1000]): WorkerOutput => ({
    s: { ms: [ms, ms, ms], roundTrips: [roundTrips], bytes: [bytes] },
  });
  return {
    meta: { rounds: rounds.length, pgImage: "pg", base: "b", head: "h" },
    rounds: rounds.map(([b, h]) => ({
      base: out(b, io.base),
      head: out(h, io.head),
    })),
  };
}

const verdicts = (r: BenchResults) =>
  Object.fromEntries(compare(r)[0]!.metrics.map((m) => [m.metric, m.verdict]));

describe("benchmark gate", () => {
  test("flags a consistent slowdown and an extra round trip", () => {
    const slow = results(
      [
        [100, 125],
        [102, 121],
        [99, 124],
        [101, 119],
        [100, 140],
        [98, 122],
      ],
      { head: [11, 1000] },
    );
    expect(verdicts(slow)).toEqual({
      time: "regression",
      "round trips": "regression",
      "bytes received": "unchanged",
    });
    expect(failures(compare(slow))).toBe(2);
  });

  test("ignores noise: outlier rounds, inconsistent direction, tiny deltas", () => {
    // One terrible round does not move the median ratio.
    const outlier = results([
      [100, 101],
      [100, 300],
      [100, 99],
      [100, 102],
      [100, 98],
      [100, 100],
    ]);
    // +20% of a 2 ms scenario is under the absolute floor.
    const tiny = results(Array.from({ length: 6 }, () => [2, 2.4]));
    // +18% median, but slower in only 4 of 6 rounds.
    const mixed = results([
      [100, 118],
      [100, 119],
      [100, 120],
      [100, 125],
      [100, 90],
      [100, 95],
    ]);
    for (const r of [outlier, tiny, mixed]) {
      expect(verdicts(r)["time"]).toBe("unchanged");
      expect(failures(compare(r))).toBe(0);
    }
  });

  test("a head error fails; a scenario the base lacks is reported, not gated", () => {
    const r = results([
      [100, 100],
      [100, 100],
      [100, 100],
    ]);
    r.rounds[1]!.head = { s: { error: "boom" } };
    expect(compare(r)[0]!.error).toBe("boom");
    expect(failures(compare(r))).toBe(1);

    const fresh = results([
      [100, 100],
      [100, 100],
      [100, 100],
    ]);
    for (const round of fresh.rounds) round.base = {};
    expect(verdicts(fresh)).toEqual({ time: "new" });
    expect(failures(compare(fresh))).toBe(0);
  });

  test("perf-accepted waives regressions and an unmeasurable base, never head errors", () => {
    const slow = results(Array.from({ length: 6 }, () => [100, 130]));
    expect(gateFails(compare(slow), false)).toBe(true);
    expect(gateFails(compare(slow), true)).toBe(false);

    // Every base worker crashed: nothing was compared, so it must not pass.
    const noBase = results(Array.from({ length: 3 }, () => [100, 100]));
    for (const round of noBase.rounds) round.base = null;
    expect(gateFails(compare(noBase), false)).toBe(true);
    expect(gateFails(compare(noBase), true)).toBe(false);

    const crashed = results(Array.from({ length: 3 }, () => [100, 100]));
    crashed.rounds[0]!.head = null;
    expect(gateFails(compare(crashed), true)).toBe(true);
  });
});
