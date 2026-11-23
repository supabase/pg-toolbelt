/** Round-by-round decisions of ./run.ts, kept apart from it so they can be tested. */
import { MIN_ROUNDS } from "./protocol.ts";

/**
 * What to do before `round`: sample it, replace both workers and then sample
 * it, or stop. Workers are replaced every `restartEvery` rounds. Past the
 * first MIN_ROUNDS the run stops when the step would overrun the budget,
 * judged by the slowest round and restart seen so far.
 */
export function nextStep(state: {
  round: number;
  restartEvery: number;
  elapsedMs: number;
  budgetMs: number;
  slowestRoundMs: number;
  slowestRestartMs: number;
}): "sample" | "restart" | "stop" {
  const restart = state.round > 0 && state.round % state.restartEvery === 0;
  const cost = state.slowestRoundMs + (restart ? state.slowestRestartMs : 0);
  if (state.round >= MIN_ROUNDS && state.elapsedMs + cost > state.budgetMs) {
    return "stop";
  }
  return restart ? "restart" : "sample";
}
