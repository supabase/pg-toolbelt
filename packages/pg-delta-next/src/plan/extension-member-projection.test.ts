/**
 * plan() applies the default extension-member projection (4b Stage 0).
 * No Docker / database required.
 *
 * Extension members are projected OUT of the managed universe on BOTH sides
 * before diffing (docs/pg-delta-next-hardening-plan.md, "Item 4b"). This test
 * injects a `memberOfExtension` edge synthetically — decoupled from the
 * extractor flip (Stage 2) — so it pins the plan-side wiring on its own: a fact
 * an extension owns must never become a planned action, and the plan's target
 * fingerprint must reflect the member-excluded state.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { PlanOptions } from "./plan.ts";
import type { StableId } from "../core/stable-id.ts";
import { plan } from "./plan.ts";

const schemaPublic: StableId = { kind: "schema", name: "public" };
const extPgmq: StableId = { kind: "extension", name: "pgmq" };
// a schema the extension owns; member roots are kept as roots here so removing
// them never orphans the extension fact (the extension is not their descendant)
const memberSchema: StableId = { kind: "schema", name: "pgmq_internal" };

const f = (id: StableId, parent?: StableId): Fact =>
  parent ? { id, parent, payload: {} } : { id, payload: {} };

// CREATE SCHEMA without AUTHORIZATION so the test needs no role fact
const opts: PlanOptions = { params: { skipAuthorization: true } };

describe("plan() — default extension-member projection (4b Stage 0)", () => {
  test("an extension-owned object never becomes a planned action", () => {
    const source = buildFactBase(
      [f(schemaPublic), f(extPgmq, schemaPublic)],
      [],
    );
    const desired = buildFactBase(
      [f(schemaPublic), f(extPgmq, schemaPublic), f(memberSchema)],
      [{ from: memberSchema, to: extPgmq, kind: "memberOfExtension" }],
    );

    const thePlan = plan(source, desired, opts);

    expect(thePlan.actions).toHaveLength(0);
    expect(thePlan.deltas).toHaveLength(0);
    // the honest target excludes the member, so it equals the (member-free) source
    expect(thePlan.target.fingerprint).toBe(thePlan.source.fingerprint);
  });

  test("a NON-member schema added in desired is still planned (no false suppression)", () => {
    const userSchema: StableId = { kind: "schema", name: "app" };
    const source = buildFactBase([f(schemaPublic)], []);
    const desired = buildFactBase([f(schemaPublic), f(userSchema)], []);

    const thePlan = plan(source, desired, opts);

    expect(thePlan.actions.length).toBeGreaterThan(0);
  });
});
