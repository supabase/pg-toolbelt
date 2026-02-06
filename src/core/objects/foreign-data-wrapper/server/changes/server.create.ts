import { createFormatContext } from "../../../../format/index.ts";
import type { SerializeOptions } from "../../../../integrations/serialize/serialize.types.ts";
import { quoteLiteral } from "../../../base.change.ts";
import { stableId } from "../../../utils.ts";
import type { Server } from "../server.model.ts";
import { CreateServerChange } from "./server.base.ts";

/**
 * Create a server.
 *
 * @see https://www.postgresql.org/docs/17/sql-createserver.html
 *
 * Synopsis
 * ```sql
 * CREATE SERVER [ IF NOT EXISTS ] server_name [ TYPE 'server_type' ] [ VERSION 'server_version' ]
 *     FOREIGN DATA WRAPPER fdw_name
 *     [ OPTIONS ( option 'value' [, ... ] ) ]
 * ```
 */
export class CreateServer extends CreateServerChange {
  public readonly server: Server;
  public readonly scope = "object" as const;

  constructor(props: { server: Server }) {
    super();
    this.server = props.server;
  }

  get creates() {
    return [this.server.stableId];
  }

  get requires() {
    const dependencies = new Set<string>();

    // Foreign Data Wrapper dependency
    dependencies.add(
      stableId.foreignDataWrapper(this.server.foreign_data_wrapper),
    );

    // Owner dependency
    dependencies.add(stableId.role(this.server.owner));

    return Array.from(dependencies);
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const lines: string[] = [
      ctx.line(ctx.keyword("CREATE"), ctx.keyword("SERVER"), this.server.name),
    ];

    if (this.server.type) {
      lines.push(ctx.line(ctx.keyword("TYPE"), quoteLiteral(this.server.type)));
    }

    if (this.server.version) {
      lines.push(
        ctx.line(ctx.keyword("VERSION"), quoteLiteral(this.server.version)),
      );
    }

    lines.push(
      ctx.line(
        ctx.keyword("FOREIGN"),
        ctx.keyword("DATA"),
        ctx.keyword("WRAPPER"),
        this.server.foreign_data_wrapper,
      ),
    );

    if (this.server.options && this.server.options.length > 0) {
      const optionPairs: string[] = [];
      for (let i = 0; i < this.server.options.length; i += 2) {
        if (i + 1 < this.server.options.length) {
          optionPairs.push(
            `${this.server.options[i]} ${quoteLiteral(this.server.options[i + 1])}`,
          );
        }
      }
      if (optionPairs.length > 0) {
        const list = ctx.list(optionPairs, 1);
        lines.push(
          ctx.line(
            ctx.keyword("OPTIONS"),
            ctx.parens(`${ctx.indent(1)}${list}`, ctx.pretty),
          ),
        );
      }
    }

    return ctx.joinLines(lines);
  }
}
