import { createFormatContext } from "../../../format/index.ts";
import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import { quoteLiteral } from "../../base.change.ts";
import { stableId } from "../../utils.ts";
import type { Rule } from "../rule.model.ts";
import { CreateRuleChange, DropRuleChange } from "./rule.base.ts";

export class CreateCommentOnRule extends CreateRuleChange {
  public readonly rule: Rule;
  public readonly scope = "comment" as const;

  constructor(props: { rule: Rule }) {
    super();
    this.rule = props.rule;
  }

  get creates() {
    return [stableId.comment(this.rule.stableId)];
  }

  get requires() {
    return [this.rule.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("COMMENT ON RULE"),
      this.rule.name,
      ctx.keyword("ON"),
      `${this.rule.schema}.${this.rule.table_name}`,
      ctx.keyword("IS"),
      // biome-ignore lint/style/noNonNullAssertion: rule comment is not nullable in this case
      quoteLiteral(this.rule.comment!),
    );
  }
}

export class DropCommentOnRule extends DropRuleChange {
  public readonly rule: Rule;
  public readonly scope = "comment" as const;

  constructor(props: { rule: Rule }) {
    super();
    this.rule = props.rule;
  }

  get drops() {
    return [stableId.comment(this.rule.stableId)];
  }

  get requires() {
    return [stableId.comment(this.rule.stableId), this.rule.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("COMMENT ON RULE"),
      this.rule.name,
      ctx.keyword("ON"),
      `${this.rule.schema}.${this.rule.table_name}`,
      ctx.keyword("IS NULL"),
    );
  }
}
