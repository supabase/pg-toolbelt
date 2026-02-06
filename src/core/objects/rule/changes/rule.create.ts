import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import { stableId } from "../../utils.ts";
import type { Rule } from "../rule.model.ts";
import { CreateRuleChange } from "./rule.base.ts";

export class CreateRule extends CreateRuleChange {
  public readonly rule: Rule;
  public readonly scope = "object" as const;
  public readonly orReplace?: boolean;

  constructor(props: { rule: Rule; orReplace?: boolean }) {
    super();
    this.rule = props.rule;
    this.orReplace = props.orReplace;
  }

  get creates() {
    return [this.rule.stableId];
  }

  get requires() {
    return [
      this.rule.relationStableId,
      ...this.rule.columns.map((column) =>
        stableId.column(this.rule.schema, this.rule.table_name, column),
      ),
    ];
  }

  serialize(_options?: SerializeOptions): string {
    // Preserve the server-generated definition as-is.
    return this.rule.definition;
  }
}
