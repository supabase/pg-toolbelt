import { maskConninfo } from "../../../sensitive.ts";
import type { SensitiveInfo } from "../../../sensitive.types.ts";
import { quoteLiteral } from "../../base.change.ts";
import { stableId } from "../../utils.ts";
import type { Subscription } from "../subscription.model.ts";
import {
  formatSubscriptionOption,
  type SubscriptionSettableOption,
} from "../utils.ts";
import { AlterSubscriptionChange } from "./subscription.base.ts";

export class AlterSubscriptionSetConnection extends AlterSubscriptionChange {
  public readonly subscription: Subscription;
  public readonly scope = "object" as const;

  constructor(props: { subscription: Subscription }) {
    super();
    this.subscription = props.subscription;
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
          instruction: `Replace __SENSITIVE_PASSWORD__ in the connection string for subscription ${this.subscription.name} with the actual password.`,
        },
      ];
    }
    return [];
  }

  serialize(): string {
    const { masked: maskedConninfo, hadPassword } = maskConninfo(
      this.subscription.conninfo,
    );

    const parts: string[] = [];

    // Add warning comment if conninfo contains password
    if (hadPassword) {
      parts.push(
        `-- WARNING: Connection string contains sensitive password`,
        `-- Replace __SENSITIVE_PASSWORD__ with actual password`,
      );
    }

    parts.push(
      `ALTER SUBSCRIPTION ${this.subscription.name} CONNECTION ${quoteLiteral(maskedConninfo)}`,
    );

    return parts.join("\n");
  }
}

export class AlterSubscriptionSetPublication extends AlterSubscriptionChange {
  public readonly subscription: Subscription;
  public readonly scope = "object" as const;

  constructor(props: { subscription: Subscription }) {
    super();
    this.subscription = props.subscription;
  }

  serialize(): string {
    const base = `ALTER SUBSCRIPTION ${this.subscription.name} SET PUBLICATION ${this.subscription.publications.join(", ")}`;
    if (!this.subscription.enabled) {
      return `${base} WITH (refresh = false)`;
    }
    return base;
  }
}

export class AlterSubscriptionEnable extends AlterSubscriptionChange {
  public readonly subscription: Subscription;
  public readonly scope = "object" as const;

  constructor(props: { subscription: Subscription }) {
    super();
    this.subscription = props.subscription;
  }

  serialize(): string {
    return `ALTER SUBSCRIPTION ${this.subscription.name} ENABLE`;
  }
}

export class AlterSubscriptionDisable extends AlterSubscriptionChange {
  public readonly subscription: Subscription;
  public readonly scope = "object" as const;

  constructor(props: { subscription: Subscription }) {
    super();
    this.subscription = props.subscription;
  }

  serialize(): string {
    return `ALTER SUBSCRIPTION ${this.subscription.name} DISABLE`;
  }
}

export class AlterSubscriptionSetOptions extends AlterSubscriptionChange {
  public readonly subscription: Subscription;
  public readonly scope = "object" as const;
  private readonly options: SubscriptionSettableOption[];

  constructor(props: {
    subscription: Subscription;
    options: SubscriptionSettableOption[];
  }) {
    super();
    this.subscription = props.subscription;
    this.options = props.options;
  }

  serialize(): string {
    const assignments = this.options.map((option) =>
      formatSubscriptionOption(this.subscription, option),
    );
    return `ALTER SUBSCRIPTION ${this.subscription.name} SET (${assignments.join(", ")})`;
  }
}

export class AlterSubscriptionSetOwner extends AlterSubscriptionChange {
  public readonly subscription: Subscription;
  public readonly scope = "object" as const;
  public readonly owner: string;

  constructor(props: { subscription: Subscription; owner: string }) {
    super();
    this.subscription = props.subscription;
    this.owner = props.owner;
  }

  get requires() {
    return [stableId.role(this.owner)];
  }

  serialize(): string {
    return `ALTER SUBSCRIPTION ${this.subscription.name} OWNER TO ${this.owner}`;
  }
}
