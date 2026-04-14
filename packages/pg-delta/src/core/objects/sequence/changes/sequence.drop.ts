import type { Sequence } from "../sequence.model.ts";
import { DropSequenceChange } from "./sequence.base.ts";

/**
 * Drop a sequence.
 *
 * @see https://www.postgresql.org/docs/17/sql-dropsequence.html
 *
 * Synopsis
 * ```sql
 * DROP SEQUENCE [ IF EXISTS ] name [, ...] [ CASCADE | RESTRICT ]
 * ```
 */
export class DropSequence extends DropSequenceChange {
  public readonly sequence: Sequence;
  public readonly scope = "object" as const;

  constructor(props: { sequence: Sequence }) {
    super();
    this.sequence = props.sequence;
  }

  get drops() {
    return [this.sequence.stableId];
  }

  get requires() {
    return [this.sequence.stableId];
  }

  serialize(): string {
    const parts = [
      "DROP SEQUENCE",
      `${this.sequence.schema}.${this.sequence.name}`,
    ];

    // Owned sequences still need CASCADE here because DROP runs in the earlier
    // phase and later ALTER TABLE statements will re-establish the desired default.
    if (
      this.sequence.owned_by_schema &&
      this.sequence.owned_by_table &&
      this.sequence.owned_by_column
    ) {
      parts.push("CASCADE");
    }

    return parts.join(" ");
  }
}
