import type { Change } from "../change.types.ts";

/**
 * Thrown by `sortChanges` when the dependency graph contains a cycle that
 * neither weak-edge filtering nor the change-injection cycle breakers could
 * resolve.
 *
 * `message` is the human-readable `formatCycleError` output (it starts with
 * "CycleError:" for backward compatibility with log greps).
 */
export class UnorderableCycleError extends Error {
  override readonly name = "UnorderableCycleError";
  /**
   * Changes participating in the cycle, in cycle order. Empty when the
   * failure came from an internal guard rather than a concrete cycle.
   */
  readonly cycle: readonly Change[];

  constructor(message: string, cycle: readonly Change[] = []) {
    super(message);
    this.cycle = cycle;
  }
}
