import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import { quoteLiteral } from "../../base.change.ts";
import type { TableLikeObject } from "../../base.model.ts";
import { stableId } from "../../utils.ts";
import type { Trigger, TriggerEnabledState } from "../trigger.model.ts";
import { AlterTriggerChange } from "./trigger.base.ts";
import { CreateTrigger } from "./trigger.create.ts";
import { DropTrigger } from "./trigger.drop.ts";

/**
 * Alter a trigger.
 *
 * @see https://www.postgresql.org/docs/17/sql-altertrigger.html
 *
 * Synopsis
 * ```sql
 * ALTER TRIGGER name ON table_name RENAME TO new_name
 * ```
 */

export type AlterTrigger = ReplaceTrigger | SetTriggerEnabledState;

/**
 * Replace a trigger by dropping and recreating it.
 * This is used when properties that cannot be altered via ALTER TRIGGER change.
 */
export class ReplaceTrigger extends AlterTriggerChange {
  public readonly trigger: Trigger;
  public readonly indexableObject?: TableLikeObject;
  public readonly scope = "object" as const;

  constructor(props: { trigger: Trigger; indexableObject?: TableLikeObject }) {
    super();
    this.trigger = props.trigger;
    this.indexableObject = props.indexableObject;
  }

  get creates() {
    return [this.trigger.stableId];
  }

  get requires() {
    return [this.trigger.stableId];
  }

  serialize(_options?: SerializeOptions): string {
    if (this.trigger.isConstraintTrigger) {
      const dropChange = new DropTrigger({ trigger: this.trigger });
      const createChange = new CreateTrigger({
        trigger: this.trigger,
        indexableObject: this.indexableObject,
        orReplace: false,
      });
      const commentSql =
        this.trigger.comment !== null
          ? [
              "COMMENT ON TRIGGER",
              this.trigger.name,
              "ON",
              `${this.trigger.schema}.${this.trigger.table_name}`,
              "IS",
              quoteLiteral(this.trigger.comment),
            ].join(" ")
          : null;

      return [dropChange.serialize(), createChange.serialize(), commentSql]
        .filter(Boolean)
        .join(";\n");
    }

    const createChange = new CreateTrigger({
      trigger: this.trigger,
      indexableObject: this.indexableObject,
      orReplace: true,
    });

    return createChange.serialize();
  }
}

export class SetTriggerEnabledState extends AlterTriggerChange {
  public readonly trigger: Trigger;
  public readonly scope = "object" as const;
  public readonly enabled: TriggerEnabledState;

  constructor(props: { trigger: Trigger; enabled?: TriggerEnabledState }) {
    super();
    this.trigger = props.trigger;
    this.enabled = props.enabled ?? props.trigger.enabled;
  }

  get requires() {
    return [
      this.trigger.stableId,
      stableId.table(this.trigger.schema, this.trigger.table_name),
    ];
  }

  serialize(_options?: SerializeOptions): string {
    const clause = clauseForState(this.enabled);
    return `ALTER TABLE ${this.trigger.schema}.${this.trigger.table_name} ${clause} ${this.trigger.name}`;
  }
}

function clauseForState(state: TriggerEnabledState) {
  switch (state) {
    case "O":
      return "ENABLE TRIGGER";
    case "D":
      return "DISABLE TRIGGER";
    case "R":
      return "ENABLE REPLICA TRIGGER";
    case "A":
      return "ENABLE ALWAYS TRIGGER";
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}
