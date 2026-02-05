import { SqlFormatter } from "../../../format/index.ts";
import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import { parseProcedureReference, stableId } from "../../utils.ts";
import type { Language } from "../language.model.ts";
import { CreateLanguageChange } from "./language.base.ts";

/**
 * Create a language.
 *
 * @see https://www.postgresql.org/docs/17/sql-createlanguage.html
 *
 * Synopsis
 * ```sql
 * CREATE [ OR REPLACE ] [ TRUSTED ] [ PROCEDURAL ] LANGUAGE name
 * [ HANDLER call_handler [ INLINE inline_handler ] [ VALIDATOR valfunction ] ]
 * ```
 */
export class CreateLanguage extends CreateLanguageChange {
  public readonly language: Language;
  public readonly orReplace?: boolean;
  public readonly scope = "object" as const;

  constructor(props: { language: Language; orReplace?: boolean }) {
    super();
    this.language = props.language;
    this.orReplace = props.orReplace;
  }

  get creates() {
    return [this.language.stableId];
  }

  get requires() {
    const dependencies = new Set<string>();

    // Owner dependency
    dependencies.add(stableId.role(this.language.owner));

    // Call handler function dependency
    if (this.language.call_handler) {
      const callHandlerProc = parseProcedureReference(
        this.language.call_handler,
      );
      if (callHandlerProc) {
        dependencies.add(
          stableId.procedure(callHandlerProc.schema, callHandlerProc.name),
        );
      }
    }

    // Inline handler function dependency
    if (this.language.inline_handler) {
      const inlineHandlerProc = parseProcedureReference(
        this.language.inline_handler,
      );
      if (inlineHandlerProc) {
        dependencies.add(
          stableId.procedure(inlineHandlerProc.schema, inlineHandlerProc.name),
        );
      }
    }

    // Validator function dependency
    if (this.language.validator) {
      const validatorProc = parseProcedureReference(this.language.validator);
      if (validatorProc) {
        dependencies.add(
          stableId.procedure(validatorProc.schema, validatorProc.name),
        );
      }
    }

    return Array.from(dependencies);
  }

  serialize(options?: SerializeOptions): string {
    if (options?.format?.enabled) {
      const formatter = new SqlFormatter(options.format);
      return this.serializeFormatted(formatter);
    }

    const parts: string[] = [`CREATE${this.orReplace ? " OR REPLACE" : ""}`];

    // Only include non-default flags. We never print the optional
    // PROCEDURAL keyword or any defaults.

    // TRUSTED keyword (default is untrusted -> omitted unless true)
    if (this.language.is_trusted) {
      parts.push("TRUSTED");
    }

    parts.push("LANGUAGE", this.language.name);

    // HANDLER (omit when null)
    if (this.language.call_handler) {
      parts.push("HANDLER", this.language.call_handler);
    }

    // INLINE (omit when null)
    if (this.language.inline_handler) {
      parts.push("INLINE", this.language.inline_handler);
    }

    // VALIDATOR (omit when null)
    if (this.language.validator) {
      parts.push("VALIDATOR", this.language.validator);
    }

    return parts.join(" ");
  }

  private serializeFormatted(formatter: SqlFormatter): string {
    const headTokens: string[] = [formatter.keyword("CREATE")];
    if (this.orReplace) {
      headTokens.push(
        formatter.keyword("OR"),
        formatter.keyword("REPLACE"),
      );
    }

    if (this.language.is_trusted) {
      headTokens.push(formatter.keyword("TRUSTED"));
    }

    headTokens.push(formatter.keyword("LANGUAGE"), this.language.name);

    const lines: string[] = [headTokens.join(" ")];

    if (this.language.call_handler) {
      lines.push(
        `${formatter.keyword("HANDLER")} ${this.language.call_handler}`,
      );
    }

    if (this.language.inline_handler) {
      lines.push(
        `${formatter.keyword("INLINE")} ${this.language.inline_handler}`,
      );
    }

    if (this.language.validator) {
      lines.push(
        `${formatter.keyword("VALIDATOR")} ${this.language.validator}`,
      );
    }

    return lines.join("\n");
  }
}
