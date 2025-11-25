// src/objects/subscription/changes/subscription.create.ts

import { maskConninfo } from "../../../sensitive.ts";
import type { SensitiveInfo } from "../../../sensitive.types.ts";
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

  get sensitiveInfo(): SensitiveInfo[] {
    const { hadPassword } = maskConninfo(this.subscription.conninfo);
    if (hadPassword) {
      return [
        {
          type: "subscription_conninfo",
          objectType: "subscription",
          objectName: this.subscription.name,
          field: "conninfo",
          placeholder: "__SENSITIVE_PASSWORD__",
          instruction: `Replace __SENSITIVE_PASSWORD__ in the connection string for subscription ${this.subscription.name} with the actual password, or run ALTER SUBSCRIPTION ${this.subscription.name} CONNECTION after this script.`,
        },
      ];
    }
    return [];
  }

  serialize(): string {
    const { masked: maskedConninfo, hadPassword } = maskConninfo(
      this.subscription.conninfo,
    );

    const commentParts: string[] = [];
    const sqlParts: string[] = [];

    // Add warning comment if conninfo contains password
    if (hadPassword) {
      commentParts.push(
        "-- WARNING: Connection string contains sensitive password",
        `-- Replace __SENSITIVE_PASSWORD__ with actual password or run ALTER SUBSCRIPTION ${this.subscription.name} CONNECTION after this script`,
      );
    }

    sqlParts.push(
      "CREATE SUBSCRIPTION",
      this.subscription.name,
      "CONNECTION",
      quoteLiteral(maskedConninfo),
      "PUBLICATION",
      this.subscription.publications.join(", "),
    );

    const optionEntries = collectSubscriptionOptions(this.subscription, {
      includeTwoPhase: true,
      includeEnabled: true,
    });
    const optionsMap = new Map(
      optionEntries.map(({ key, value }) => [key, value]),
    );

    if (!this.subscription.replication_slot_created) {
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
      sqlParts.push("WITH", `(${withOptions.join(", ")})`);
    }

    const sql = sqlParts.join(" ");
    return commentParts.length > 0 ? `${commentParts.join("\n")}\n${sql}` : sql;
  }
}
