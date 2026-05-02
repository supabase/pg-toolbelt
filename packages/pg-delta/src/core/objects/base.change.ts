import type { SerializeOptions } from "../integrations/serialize/serialize.types.ts";
import { isMetadataStableId } from "../stable-id.ts";

type ChangeOperation = "create" | "alter" | "drop";
export type Phase = "drop" | "forward";

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

  get phase(): Phase {
    switch (this.operation) {
      case "drop":
        return "drop";
      case "create":
        return "forward";
      case "alter": {
        // ALTER classification is based on whether an actual object is dropped.
        // Privilege/comment/default-privilege alterations either drop metadata
        // stable IDs or nothing, so they naturally stay in the forward phase.
        const dropsRealObject = this.drops.some(
          (id) => !isMetadataStableId(id),
        );
        return dropsRealObject ? "drop" : "forward";
      }
      default: {
        const unhandledOperation: never = this.operation;
        return unhandledOperation;
      }
    }
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
