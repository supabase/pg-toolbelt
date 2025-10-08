import type { Extension } from "../extension.model.ts";
import { DropExtensionChange } from "./extension.base.ts";

/**
 * Drop an extension.
 *
 * @see https://www.postgresql.org/docs/17/sql-dropextension.html
 *
 * Synopsis
 * ```sql
 * DROP EXTENSION [ IF EXISTS ] name [, ...] [ CASCADE | RESTRICT ]
 * ```
 */
export class DropExtension extends DropExtensionChange {
  public readonly extension: Extension;
  public readonly scope = "object" as const;

  constructor(props: { extension: Extension }) {
    super();
    this.extension = props.extension;
  }

  get dependencies() {
    return [this.extension.stableId];
  }

  serialize(): string {
    return ["DROP EXTENSION", this.extension.name].join(" ");
  }
}
