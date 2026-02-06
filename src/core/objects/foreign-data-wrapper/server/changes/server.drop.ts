import { createFormatContext } from "../../../../format/index.ts";
import type { SerializeOptions } from "../../../../integrations/serialize/serialize.types.ts";
import type { Server } from "../server.model.ts";
import { DropServerChange } from "./server.base.ts";

/**
 * Drop a server.
 *
 * @see https://www.postgresql.org/docs/17/sql-dropserver.html
 *
 * Synopsis
 * ```sql
 * DROP SERVER [ IF EXISTS ] name [, ...] [ CASCADE | RESTRICT ]
 * ```
 */
export class DropServer extends DropServerChange {
  public readonly server: Server;
  public readonly scope = "object" as const;

  constructor(props: { server: Server }) {
    super();
    this.server = props.server;
  }

  get drops() {
    return [this.server.stableId];
  }

  get requires() {
    return [this.server.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(ctx.keyword("DROP SERVER"), this.server.name);
  }
}
