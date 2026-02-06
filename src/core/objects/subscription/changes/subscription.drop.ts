import { createFormatContext } from "../../../format/index.ts";
import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import type { Subscription } from "../subscription.model.ts";
import { DropSubscriptionChange } from "./subscription.base.ts";

export class DropSubscription extends DropSubscriptionChange {
  public readonly subscription: Subscription;
  public readonly scope = "object" as const;

  constructor(props: { subscription: Subscription }) {
    super();
    this.subscription = props.subscription;
  }

  get drops() {
    return [this.subscription.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(ctx.keyword("DROP SUBSCRIPTION"), this.subscription.name);
  }
}
