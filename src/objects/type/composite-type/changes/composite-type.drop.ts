import { DropChange, quoteIdentifier } from "../../../base.change.ts";
import type { CompositeType } from "../composite-type.model.ts";

/**
 * Drop a composite type.
 *
 * @see https://www.postgresql.org/docs/17/sql-droptype.html
 *
 * Synopsis
 * ```sql
 * DROP TYPE [ IF EXISTS ] name [, ...] [ CASCADE | RESTRICT ]
 * ```
 */
export class DropCompositeType extends DropChange {
  public readonly stableId: string;
  public readonly compositeType: CompositeType;

  constructor(props: { compositeType: CompositeType }) {
    super();
    this.compositeType = props.compositeType;
    this.stableId = `${this.compositeType.stableId}`;
  }

  serialize(): string {
    return [
      "DROP TYPE",
      `${quoteIdentifier(this.compositeType.schema)}.${quoteIdentifier(this.compositeType.name)}`,
    ].join(" ");
  }
}
