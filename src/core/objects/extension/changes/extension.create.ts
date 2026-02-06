import { createFormatContext } from "../../../format/index.ts";
import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import { stableId } from "../../utils.ts";
import type { Extension } from "../extension.model.ts";
import { CreateExtensionChange } from "./extension.base.ts";

/**
 * Create an extension.
 *
 * @see https://www.postgresql.org/docs/17/sql-createextension.html
 *
 * Synopsis
 * ```sql
 * CREATE EXTENSION [ IF NOT EXISTS ] extension_name
 *     [ WITH ] [ SCHEMA schema_name ]
 *              [ VERSION version ]
 *              [ CASCADE ]
 * ```
 */
export class CreateExtension extends CreateExtensionChange {
  public readonly extension: Extension;
  public readonly scope = "object" as const;

  constructor(props: { extension: Extension }) {
    super();
    this.extension = props.extension;
  }

  get creates() {
    return [this.extension.stableId, ...this.extension.members];
  }

  get requires() {
    const dependencies = new Set<string>();

    // Schema dependency
    dependencies.add(stableId.schema(this.extension.schema));

    // Owner dependency
    dependencies.add(stableId.role(this.extension.owner));

    return Array.from(dependencies);
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const lines: string[] = [
      ctx.line(ctx.keyword("CREATE"), ctx.keyword("EXTENSION"), this.extension.name),
      ctx.line(ctx.keyword("WITH"), ctx.keyword("SCHEMA"), this.extension.schema),
    ];

    return ctx.joinLines(lines);
  }
}
