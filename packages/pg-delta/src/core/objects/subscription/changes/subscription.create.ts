import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
// src/objects/subscription/changes/subscription.create.ts
import { quoteLiteral } from "../../base.change.ts";
import { stableId } from "../../utils.ts";
import type { Subscription } from "../subscription.model.ts";
import { collectSubscriptionOptions } from "../utils.ts";
import { CreateSubscriptionChange } from "./subscription.base.ts";

export class CreateSubscription extends CreateSubscriptionChange {
  readonly subscription: Subscription;
  readonly scope = "object" as const;

  constructor(props: { subscription: Subscription }) {
    super();
    this.subscription = props.subscription;
  }

  get creates() {
    return [this.subscription.stableId];
  }

  get requires() {
    return [stableId.role(this.subscription.owner)];
  }

  // No nonTransactional override: PostgreSQL's transaction-block gate for
  // CREATE SUBSCRIPTION is on create_slot = true, and serialize() always
  // emits create_slot = false (either reusing an existing slot or skipping
  // the connect entirely).

  serialize(_options?: SerializeOptions): string {
    const parts: string[] = [
      "CREATE SUBSCRIPTION",
      this.subscription.name,
      "CONNECTION",
      quoteLiteral(this.subscription.conninfo),
      "PUBLICATION",
      this.subscription.publications.join(", "),
    ];

    const optionEntries = collectSubscriptionOptions(this.subscription, {
      includeTwoPhase: true,
      includeEnabled: true,
    });
    const optionsMap = new Map(
      optionEntries.map(({ key, value }) => [key, value]),
    );

    if (this.subscription.replication_slot_created) {
      // The slot already exists on the publisher: keep the connect = true
      // default so it is looked up, but never recreated.
      optionsMap.set("create_slot", "false");
    } else {
      optionsMap.set("create_slot", "false");
      optionsMap.set("connect", "false");

      const defaultSlotName = this.subscription.raw_name;
      const slotName = this.subscription.slot_name ?? defaultSlotName;
      const shouldUseNone =
        this.subscription.slot_is_none || slotName === defaultSlotName;

      if (shouldUseNone) {
        optionsMap.set("slot_name", "NONE");
      } else {
        optionsMap.set("slot_name", quoteLiteral(slotName));
      }
    }

    const withOptions = Array.from(optionsMap.entries()).map(
      ([key, value]) => `${key} = ${value}`,
    );

    if (withOptions.length > 0) {
      parts.push("WITH", `(${withOptions.join(", ")})`);
    }

    return parts.join(" ");
  }
}
