import { createFormatContext } from "../../../format/index.ts";
import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import type { Rule } from "../rule.model.ts";
import { DropRuleChange } from "./rule.base.ts";

export class DropRule extends DropRuleChange {
  public readonly rule: Rule;
  public readonly scope = "object" as const;

  constructor(props: { rule: Rule }) {
    super();
    this.rule = props.rule;
  }

  get drops() {
    return [this.rule.stableId];
  }

  get requires() {
    return [this.rule.stableId, this.rule.relationStableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("DROP RULE"),
      this.rule.name,
      ctx.keyword("ON"),
      `${this.rule.schema}.${this.rule.table_name}`,
    );
  }
}
