import { createFormatContext } from "../../../format/index.ts";
import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import type { Index } from "../index.model.ts";
import { DropIndexChange } from "./index.base.ts";

/**
 * Drop an index.
 *
 * @see https://www.postgresql.org/docs/17/sql-dropindex.html
 *
 * Synopsis
 * ```sql
 * DROP INDEX [ CONCURRENTLY ] [ IF EXISTS ] name [, ...] [ CASCADE | RESTRICT ]
 * ```
 */
export class DropIndex extends DropIndexChange {
  public readonly index: Index;
  public readonly scope = "object" as const;

  constructor(props: { index: Index }) {
    super();
    this.index = props.index;
  }

  get drops() {
    return [this.index.stableId];
  }

  get requires() {
    return [this.index.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("DROP INDEX"),
      `${this.index.schema}.${this.index.name}`,
    );
  }
}
