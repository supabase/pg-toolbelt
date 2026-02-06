import type { TableLikeObject } from "../../base.model.ts";
import { stableId } from "../../utils.ts";
import type { Trigger } from "../trigger.model.ts";
import { CreateTriggerChange } from "./trigger.base.ts";

/**
 * Create a trigger.
 *
 * @see https://www.postgresql.org/docs/17/sql-createtrigger.html
 *
 * Synopsis
 * ```sql
 * CREATE [ OR REPLACE ] [ CONSTRAINT ] TRIGGER name { BEFORE | AFTER | INSTEAD OF } { event [ OR ... ] }
 *     ON table_name
 *     [ FROM referenced_table_name ]
 *     [ NOT DEFERRABLE | [ DEFERRABLE ] [ INITIALLY IMMEDIATE | INITIALLY DEFERRED ] ]
 *     [ REFERENCING { { OLD | NEW } TABLE [ AS ] transition_relation_name } [ ... ] ]
 *     [ FOR [ EACH ] { ROW | STATEMENT } ]
 *     [ WHEN ( condition ) ]
 *     EXECUTE { FUNCTION | PROCEDURE } function_name ( arguments )
 *
 * where event can be one of:
 *
 *     INSERT
 *     UPDATE [ OF column_name [, ... ] ]
 *     DELETE
 *     TRUNCATE
 * ```
 */
export class CreateTrigger extends CreateTriggerChange {
  public readonly trigger: Trigger;
  public readonly indexableObject?: TableLikeObject;
  public readonly orReplace?: boolean;
  public readonly scope = "object" as const;

  constructor(props: {
    trigger: Trigger;
    indexableObject?: TableLikeObject;
    orReplace?: boolean;
  }) {
    super();
    this.trigger = props.trigger;
    this.indexableObject = props.indexableObject;
    this.orReplace = props.orReplace;
  }

  get creates() {
    return [this.trigger.stableId];
  }

  get requires() {
    const dependencies = new Set<string>();

    // Schema dependency
    dependencies.add(stableId.schema(this.trigger.schema));

    // Table dependency
    dependencies.add(
      stableId.table(this.trigger.schema, this.trigger.table_name),
    );

    // Function dependency
    // Trigger functions always have signature () RETURNS trigger, so no arguments.
    dependencies.add(
      stableId.procedure(
        this.trigger.function_schema,
        this.trigger.function_name,
      ),
    );

    // Owner dependency
    dependencies.add(stableId.role(this.trigger.owner));

    return Array.from(dependencies);
  }

  serialize(): string {
    let definition = this.trigger.definition.trim();
    const isConstraintTrigger = this.trigger.isConstraintTrigger;

    definition = definition.replace(
      /^CREATE\s+(?:OR\s+REPLACE\s+)?/i,
      `CREATE ${this.orReplace && !isConstraintTrigger ? "OR REPLACE " : ""}`,
    );

    return definition;
  }
}
