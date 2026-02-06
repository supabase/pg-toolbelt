import { createFormatContext } from "../../../format/index.ts";
import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import { quoteLiteral } from "../../base.change.ts";
import { parseProcedureReference, stableId } from "../../utils.ts";
import type { EventTrigger } from "../event-trigger.model.ts";
import { CreateEventTriggerChange } from "./event-trigger.base.ts";

/**
 * Create an event trigger.
 *
 * @see https://www.postgresql.org/docs/17/sql-createeventtrigger.html
 *
 * Synopsis
 * ```sql
 * CREATE EVENT TRIGGER name
 *     ON event
 *     [ WHEN TAG IN (tag [, ...]) [ AND ... ] ]
 *     EXECUTE { FUNCTION | PROCEDURE } function_name()
 * ```
 */
export class CreateEventTrigger extends CreateEventTriggerChange {
  public readonly eventTrigger: EventTrigger;
  public readonly scope = "object" as const;

  constructor(props: { eventTrigger: EventTrigger }) {
    super();
    this.eventTrigger = props.eventTrigger;
  }

  get creates() {
    return [this.eventTrigger.stableId];
  }

  get requires() {
    const dependencies = new Set<string>();

    // Owner dependency
    dependencies.add(stableId.role(this.eventTrigger.owner));

    // Function dependency
    // Note: Event triggers call functions with no arguments, so we can build the stableId
    const procRef = parseProcedureReference(
      `${this.eventTrigger.function_schema}.${this.eventTrigger.function_name}()`,
    );
    if (procRef) {
      // Event trigger functions have no arguments, so stableId is procedure:schema.name()
      dependencies.add(stableId.procedure(procRef.schema, procRef.name));
    }

    return Array.from(dependencies);
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const lines: string[] = [
      ctx.line(
        ctx.keyword("CREATE"),
        ctx.keyword("EVENT"),
        ctx.keyword("TRIGGER"),
        this.eventTrigger.name,
      ),
      ctx.line(ctx.keyword("ON"), this.eventTrigger.event),
    ];

    const tags = this.eventTrigger.tags;
    if (tags && tags.length > 0) {
      const tagList = tags.map((tag) => quoteLiteral(tag));
      const list = ctx.list(tagList, 1);
      lines.push(
        ctx.line(
          ctx.keyword("WHEN"),
          ctx.keyword("TAG"),
          ctx.keyword("IN"),
          ctx.parens(`${ctx.indent(1)}${list}`, ctx.pretty),
        ),
      );
    }

    lines.push(
      ctx.line(
        ctx.keyword("EXECUTE"),
        ctx.keyword("FUNCTION"),
        `${this.eventTrigger.function_schema}.${this.eventTrigger.function_name}()`,
      ),
    );

    return ctx.joinLines(lines);
  }
}
