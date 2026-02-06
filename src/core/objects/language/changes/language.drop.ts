import { createFormatContext } from "../../../format/index.ts";
import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import type { Language } from "../language.model.ts";
import { DropLanguageChange } from "./language.base.ts";

/**
 * Drop a language.
 *
 * @see https://www.postgresql.org/docs/17/sql-droplanguage.html
 *
 * Synopsis
 * ```sql
 * DROP [ PROCEDURAL ] LANGUAGE [ IF EXISTS ] name [ CASCADE | RESTRICT ]
 * ```
 */
export class DropLanguage extends DropLanguageChange {
  public readonly language: Language;
  public readonly scope = "object" as const;

  constructor(props: { language: Language }) {
    super();
    this.language = props.language;
  }

  get drops() {
    return [this.language.stableId];
  }

  get requires() {
    return [this.language.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const parts: string[] = [ctx.keyword("DROP")];

    // Do not print optional keywords (e.g., PROCEDURAL). Keep the statement minimal.
    parts.push(ctx.keyword("LANGUAGE"), this.language.name);

    return ctx.line(...parts);
  }
}
