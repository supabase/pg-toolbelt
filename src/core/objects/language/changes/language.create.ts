import { createFormatContext } from "../../../format/index.ts";
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
    const ctx = createFormatContext(options?.format);
    const headTokens: string[] = [ctx.keyword("CREATE")];
    if (this.orReplace) {
      headTokens.push(ctx.keyword("OR"), ctx.keyword("REPLACE"));
    }

    if (this.language.is_trusted) {
      headTokens.push(ctx.keyword("TRUSTED"));
    }

    headTokens.push(ctx.keyword("LANGUAGE"), this.language.name);

    const lines: string[] = [headTokens.join(" ")];

    if (this.language.call_handler) {
      lines.push(
        ctx.line(ctx.keyword("HANDLER"), this.language.call_handler),
      );
    }

    if (this.language.inline_handler) {
      lines.push(
        ctx.line(ctx.keyword("INLINE"), this.language.inline_handler),
      );
    }

    if (this.language.validator) {
      lines.push(
        ctx.line(ctx.keyword("VALIDATOR"), this.language.validator),
      );
    }

    return ctx.joinLines(lines);
  }
}
