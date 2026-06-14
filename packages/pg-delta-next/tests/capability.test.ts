/**
 * probeApplierCapability against a real connection (managed-view move 6).
 * The capability-restricted view's projection logic is unit-tested
 * (src/policy/capability.test.ts); this proves the probe query runs and reports
 * the connection's role / superuser / memberships. Docker required.
 */
import { describe, expect, test } from "bun:test";
import { probeApplierCapability } from "../src/policy/capability.ts";
import { sharedCluster } from "./containers.ts";

describe("probeApplierCapability (integration)", () => {
  test("reports the connection's role, superuser flag, and memberships", async () => {
    const cluster = await sharedCluster();
    const cap = await probeApplierCapability(cluster.adminPool);
    // the container admin is a superuser
    expect(cap.role.length).toBeGreaterThan(0);
    expect(cap.isSuperuser).toBe(true);
    expect(cap.memberOf instanceof Set).toBe(true);
  }, 60_000);
});
