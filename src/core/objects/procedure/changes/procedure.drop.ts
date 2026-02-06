import { createFormatContext } from "../../../format/index.ts";
import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import type { Procedure } from "../procedure.model.ts";
import { formatFunctionArguments } from "../utils.ts";
import { DropProcedureChange } from "./procedure.base.ts";

/**
 * Drop a procedure.
 *
 * @see https://www.postgresql.org/docs/17/sql-dropfunction.html
 *
 * Synopsis
 * ```sql
 * DROP FUNCTION [ IF EXISTS ] name ( [ [ argmode ] [ argname ] argtype [, ...] ] ) [, ...] [ CASCADE | RESTRICT ]
 * DROP PROCEDURE [ IF EXISTS ] name ( [ [ argmode ] [ argname ] argtype [, ...] ] ) [, ...] [ CASCADE | RESTRICT ]
 * ```
 */
export class DropProcedure extends DropProcedureChange {
  public readonly procedure: Procedure;
  public readonly scope = "object" as const;

  constructor(props: { procedure: Procedure }) {
    super();
    this.procedure = props.procedure;
  }

  get drops() {
    return [this.procedure.stableId];
  }

  get requires() {
    return [this.procedure.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const objectType = this.procedure.kind === "p" ? "PROCEDURE" : "FUNCTION";

    // Build argument list
    const args = formatFunctionArguments(
      this.procedure.argument_names,
      this.procedure.argument_types,
      this.procedure.argument_modes,
    );

    return ctx.line(
      ctx.keyword("DROP"),
      ctx.keyword(objectType),
      `${this.procedure.schema}.${this.procedure.name}(${args})`,
    );
  }
}
