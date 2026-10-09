/** Messages between ./run.ts, ./worker.ts, and ./compare.ts. */

export interface BenchUrls {
  admin: string;
  large: string;
  mutated: string;
  empty: string;
}

export interface ScenarioSample {
  ms: number[];
  /** Per timed iteration; present only for scenarios that talk to Postgres. */
  roundTrips?: number[];
  /** New connections; each costs several round trips (startup + auth). */
  connections?: number[];
  bytes?: number[];
}

export type WorkerOutput = Record<string, ScenarioSample | { error: string }>;

export const PROTOCOL_PREFIX = "@@bench ";

/** One protocol line: setup outcome, then one reply per command. */
export type WorkerMessage =
  | { ready: string[] }
  | { setupError: string }
  | { scenario: string; result: ScenarioSample | { error: string } };

export type Side = "base" | "head";

export interface BenchResults {
  meta: {
    rounds: number;
    pgImage: string;
    base: string;
    head: string;
  };
  /** `rounds[i][side]`: that side's samples; `null` once its worker died. */
  rounds: Record<Side, WorkerOutput | null>[];
}
