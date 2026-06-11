import { describe, expect, test } from "bun:test";
import type { Subscription, SubscriptionProps } from "../subscription.model.ts";
import { Subscription as SubscriptionModel } from "../subscription.model.ts";
import { AlterSubscriptionSetPublication } from "./subscription.alter.ts";
import { CreateSubscription } from "./subscription.create.ts";
import { DropSubscription } from "./subscription.drop.ts";

function makeSubscription(
  overrides: Partial<SubscriptionProps> = {},
): Subscription {
  return new SubscriptionModel({
    name: "sub_orders",
    raw_name: "sub_orders",
    owner: "postgres",
    comment: null,
    enabled: false,
    binary: false,
    streaming: "off",
    two_phase: false,
    disable_on_error: false,
    password_required: true,
    run_as_owner: false,
    failover: false,
    conninfo: "host=publisher dbname=app",
    slot_name: "sub_orders",
    slot_is_none: false,
    replication_slot_created: false,
    synchronous_commit: "off",
    publications: ["pub_orders"],
    origin: "any",
    ...overrides,
  });
}

describe("subscription transaction-block traits", () => {
  test("CREATE SUBSCRIPTION with a created slot cannot run in a transaction block", () => {
    // serialize() leaves the connect = true default in this case, which
    // PostgreSQL rejects inside a transaction block (25001).
    const change = new CreateSubscription({
      subscription: makeSubscription({ replication_slot_created: true }),
    });
    expect(change.nonTransactional).toBe(true);
  });

  test("CREATE SUBSCRIPTION with connect = false is transactional", () => {
    const change = new CreateSubscription({
      subscription: makeSubscription({ replication_slot_created: false }),
    });
    expect(change.nonTransactional).toBe(false);
  });

  test("ALTER SUBSCRIPTION SET PUBLICATION with implicit refresh cannot run in a transaction block", () => {
    // serialize() omits WITH (refresh = false) when the subscription is
    // enabled, and refresh = true is rejected inside a transaction block.
    const change = new AlterSubscriptionSetPublication({
      subscription: makeSubscription({ enabled: true }),
    });
    expect(change.nonTransactional).toBe(true);
  });

  test("ALTER SUBSCRIPTION SET PUBLICATION with refresh = false is transactional", () => {
    const change = new AlterSubscriptionSetPublication({
      subscription: makeSubscription({ enabled: false }),
    });
    expect(change.nonTransactional).toBe(false);
  });

  test("DROP SUBSCRIPTION with an associated slot cannot run in a transaction block", () => {
    const change = new DropSubscription({
      subscription: makeSubscription({ slot_is_none: false }),
    });
    expect(change.nonTransactional).toBe(true);
  });

  test("DROP SUBSCRIPTION with slot_name = NONE is transactional", () => {
    const change = new DropSubscription({
      subscription: makeSubscription({ slot_is_none: true, slot_name: null }),
    });
    expect(change.nonTransactional).toBe(false);
  });
});
