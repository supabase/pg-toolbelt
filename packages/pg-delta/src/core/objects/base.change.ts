import type { SerializeOptions } from "../integrations/serialize/serialize.types.ts";

type ChangeOperation = "create" | "alter" | "drop";

/**
 * Kinds of commit-visibility boundaries a change can force.
 *
 * Each kind names a PostgreSQL behavior where a statement's effects only
 * become usable by later statements after the enclosing transaction commits.
 * The token becomes the `reason` of the migration unit that follows the
 * producer run, so adding a kind requires a matching arm in the renderer's
 * `unitName` switch (the exhaustive switch enforces this at compile time).
 */
export type CommitBoundaryReason = "enum_value_visibility";

/**
 * Abstract base class for all change objects.
 *
 * Every concrete change (e.g. `CreateTable`, `AlterView`) extends this class and
 * provides an `operation`, `objectType`, and `scope`. The filter DSL flattens
 * these properties — along with the model sub-object — into path/value pairs
 * for pattern matching.
 *
 * @category Base
 */
export abstract class BaseChange {
  /**
   * The operation of the change.
   */
  abstract readonly operation: ChangeOperation;
  /**
   * The type of the object targeted by the change.
   */
  abstract readonly objectType: string;
  /**
   * The scope of the change.
   */
  abstract readonly scope: string;

  /**
   * True when the serialized statement cannot run inside a transaction block
   * (PostgreSQL rejects it with SQLSTATE 25001, e.g. `CREATE INDEX
   * CONCURRENTLY`, `CREATE SUBSCRIPTION` with `connect = true`).
   *
   * The planner emits such a change as its own single-statement migration
   * unit with `transactionMode: "none"`, and `applyPlan` executes it without
   * a `BEGIN`/`COMMIT` wrapper. Never derive this from the rendered SQL —
   * declare it on the change class.
   *
   * Defaults to false. Override in subclasses whose statement PostgreSQL
   * forbids inside a transaction block.
   */
  get nonTransactional(): boolean {
    return false;
  }

  /**
   * Non-null when this statement's effects only become usable by later
   * statements after the enclosing transaction commits. The canonical case is
   * `ALTER TYPE ... ADD VALUE`: using the new enum value in the same
   * transaction fails with 55P04.
   *
   * This is a conservative boundary signal: the planner groups consecutive
   * producers of the same kind into one unit, and pushes any other statement
   * (different kind or non-producer) past a commit boundary, regardless of
   * whether it references the produced effects. No consumer detection is
   * attempted. Never derive this from the rendered SQL — declare it on the
   * change class.
   *
   * Defaults to null. Override in subclasses whose effects PostgreSQL defers
   * until commit.
   */
  get commitBoundary(): CommitBoundaryReason | null {
    return null;
  }

  /**
   * Stable identifiers this change creates.
   *
   * Defaults to an empty array. Override in subclasses that create objects.
   */
  get creates(): string[] {
    return [];
  }

  /**
   * Stable identifiers this change drops.
   *
   * Defaults to an empty array. Override in subclasses that remove objects.
   */
  get drops(): string[] {
    return [];
  }

  /**
   * Stable identifiers this change invalidates in place.
   *
   * Unlike `drops`, the object keeps its identity. This is an ordering-only
   * signal for mutations that rewrite an existing object in a way that requires
   * dependents bound to the old definition to be dropped before the mutation
   * and rebuilt afterward.
   *
   * Defaults to an empty array. Override in subclasses that invalidate
   * dependents without dropping the object.
   */
  get invalidates(): string[] {
    return [];
  }

  /**
   * Stable identifiers this change requires to exist beforehand.
   *
   * Defaults to an empty array. Override in subclasses that have prerequisites.
   */
  get requires(): string[] {
    return [];
  }

  /**
   * Serialize the change into a single SQL statement.
   */
  abstract serialize(options?: SerializeOptions): string;
}

/**
 * Port of string literal quoting: doubles single quotes inside and wraps with single quotes
 */
export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
