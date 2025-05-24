import type { SequenceDefinition } from "../objects/sequences/types.ts";
import type { TableDefinition } from "../objects/tables/types.ts";

export type DatabaseDefinition = {
  sequences: SequenceDefinition[];
  tables: TableDefinition[];
};

export type DiffOperation<T> = {
  type: "create" | "drop" | "alter";
  object: T;
  changes?: {
    property: keyof T;
    oldValue: T[keyof T];
    newValue: T[keyof T];
  }[];
};

export type SchemaDiff = {
  tables: DiffOperation<TableDefinition>[];
  sequences: DiffOperation<SequenceDefinition>[];
};

/**
 * Represents the input for a database diff operation.
 * There are two main scenarios:
 * 1. Comparing two states (source and target both provided):
 *    - Determines what changes are needed to transform source into target
 * 2. Creating from scratch (only target provided):
 *    - Effectively a "dump" operation where we're creating everything from nothing
 *    - All objects in target will be treated as "create" operations
 */
export type DiffInput = {
  /**
   * The current state of the database.
   * When omitted, this represents a "dump" scenario where we're creating
   * everything from scratch (all objects in target will be create operations).
   */
  source?: DatabaseDefinition;
  /**
   * The desired state of the database.
   * In a dump scenario, this represents the complete desired state
   * that will be created from scratch.
   */
  target: DatabaseDefinition;
};
