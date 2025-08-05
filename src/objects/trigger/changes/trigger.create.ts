import { CreateChange, quoteIdentifier } from "../../base.change.ts";
import type { Trigger } from "../trigger.model.ts";

/**
 * Create a trigger.
 *
 * @see https://www.postgresql.org/docs/17/sql-createtrigger.html
 *
 * Synopsis
 * ```sql
 * CREATE [ CONSTRAINT ] TRIGGER name { BEFORE | AFTER | INSTEAD OF } { event [ OR ... ] }
 *     ON table_name
 *     [ FROM referenced_table_name ]
 *     [ NOT DEFERRABLE | [ DEFERRABLE ] { INITIALLY IMMEDIATE | INITIALLY DEFERRED } ]
 *     [ REFERENCING { { OLD | NEW } TABLE [ AS ] transition_relation_name } [ ... ] ]
 *     [ FOR [ EACH ] { ROW | STATEMENT } ]
 *     [ WHEN ( condition ) ]
 *     EXECUTE { FUNCTION | PROCEDURE } function_name ( arguments )
 * ```
 */
export class CreateTrigger extends CreateChange {
  public readonly trigger: Trigger;

  constructor(props: { trigger: Trigger }) {
    super();
    this.trigger = props.trigger;
  }

  serialize(): string {
    const parts: string[] = ["CREATE TRIGGER"];

    // Add trigger name
    parts.push(quoteIdentifier(this.trigger.name));

    // Add timing (simplified - would need to decode trigger_type)
    parts.push("AFTER");

    // Add events (simplified - would need to decode trigger_type)
    parts.push("INSERT OR UPDATE OR DELETE");

    // Add ON table
    parts.push(
      "ON",
      quoteIdentifier(this.trigger.table_schema),
      ".",
      quoteIdentifier(this.trigger.table_name),
    );

    // Add deferrable options
    if (this.trigger.deferrable) {
      parts.push("DEFERRABLE");
      if (this.trigger.initially_deferred) {
        parts.push("INITIALLY DEFERRED");
      } else {
        parts.push("INITIALLY IMMEDIATE");
      }
    } else {
      parts.push("NOT DEFERRABLE");
    }

    // Add FOR EACH ROW/STATEMENT (simplified)
    parts.push("FOR EACH ROW");

    // Add WHEN condition
    if (this.trigger.when_condition) {
      parts.push("WHEN", `(${this.trigger.when_condition})`);
    }

    // Add EXECUTE FUNCTION
    parts.push(
      "EXECUTE FUNCTION",
      quoteIdentifier(this.trigger.function_schema),
      ".",
      quoteIdentifier(this.trigger.function_name),
    );

    // Add arguments
    if (this.trigger.arguments && this.trigger.arguments.length > 0) {
      parts.push(`(${this.trigger.arguments.join(", ")})`);
    }

    return parts.join(" ");
  }
}
