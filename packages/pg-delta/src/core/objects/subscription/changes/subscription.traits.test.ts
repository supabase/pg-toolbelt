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
  test("CREATE SUBSCRIPTION is always transactional", () => {
    // PostgreSQL's transaction-block gate is on create_slot = true, and
    // serialize() always emits create_slot = false: connect stays true when
    // the slot already exists (it is reused, never recreated), and connect
    // is false otherwise.
    const withSlot = new CreateSubscription({
      subscription: makeSubscription({ replication_slot_created: true }),
    });
    expect(withSlot.nonTransactional).toBe(false);
    expect(withSlot.serialize()).toContain("create_slot = false");

    const withoutSlot = new CreateSubscription({
      subscription: makeSubscription({ replication_slot_created: false }),
    });
    expect(withoutSlot.nonTransactional).toBe(false);
    expect(withoutSlot.serialize()).toContain("create_slot = false");
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
