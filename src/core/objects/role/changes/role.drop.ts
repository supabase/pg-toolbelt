import { createFormatContext } from "../../../format/index.ts";
import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import type { Role } from "../role.model.ts";
import { DropRoleChange } from "./role.base.ts";

/**
 * Drop a role.
 *
 * @see https://www.postgresql.org/docs/17/sql-droprole.html
 *
 * Synopsis
 * ```sql
 * DROP ROLE [ IF EXISTS ] name [, ...]
 * ```
 */
export class DropRole extends DropRoleChange {
  public readonly role: Role;
  public readonly scope = "object" as const;

  constructor(props: { role: Role }) {
    super();
    this.role = props.role;
  }

  get drops() {
    return [this.role.stableId];
  }

  get requires() {
    return [this.role.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(ctx.keyword("DROP ROLE"), this.role.name);
  }
}
