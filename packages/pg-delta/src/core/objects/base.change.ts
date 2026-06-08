import type { SerializeOptions } from "../integrations/serialize/serialize.types.ts";

type ChangeOperation = "create" | "alter" | "drop";

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
   * A unique identifier for the change.
   */
  get changeId(): string {
    return `${this.operation}:${this.scope}:${this.objectType}:${this.serialize()}`;
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
   * Stable identifiers this change requires to exist beforehand.
   *
   * Defaults to an empty array. Override in subclasses that have prerequisites.
   */
  get requires(): string[] {
    return [];
  }

  /**
   * Stable identifiers this change invalidates in place.
   *
   * Unlike `drops`, the object keeps its identity — it is neither removed nor
   * recreated. But an in-place mutation (for example `ALTER COLUMN ... TYPE`,
   * which forces a PostgreSQL table rewrite) invalidates everything bound to
   * the old definition, so dependents must be dropped before this change and
   * rebuilt after it — the same ordering a real drop-and-recreate would demand.
   *
   * The sorter consumes this for ordering only: in the drop phase the
   * invalidated ids act as producers, so the catalog's existing `pg_depend`
   * edges order each dependent's teardown ahead of this change. It deliberately
   * does NOT feed `drops`, so phase assignment, filtering, fingerprints, and
   * serialization are unchanged. Recreation order needs no help here — the
   * create phase always runs after the entire drop phase.
   *
   * Defaults to an empty array. Override in subclasses that mutate an object in
   * place in a way that invalidates its dependents.
   */
  get invalidates(): string[] {
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
