/**
 * Unit tests for extension-member exclusion (src/policy/extension-members.ts).
 * No Docker / database required.
 *
 * 4b (docs/pg-delta-next-hardening-plan.md, "Item 4b — provenance flip"):
 * objects an extension OWNS (pgmq `q_*` queue tables, pg_cron's `cron.job`,
 * a contrib's functions) are observed at extraction as facts carrying a
 * `memberOfExtension` edge — "provenance is data" (§3.1) — and then projected
 * OUT of the managed universe by default, on BOTH sides, so they are never
 * diffed. This mirrors `excludeManaged` (managedBy): same fact-level subtraction,
 * a different provenance edge.
 */

import { describe, expect, test } from "bun:test";
import { diff } from "../core/diff.ts";
import { buildFactBase, type DependencyEdge, type Fact } from "../core/fact.ts";
import type { Payload } from "../core/hash.ts";
import { encodeId, type StableId } from "../core/stable-id.ts";
import { excludeExtensionMembers } from "./extension-members.ts";

const schemaPublic: StableId = { kind: "schema", name: "public" };
const schemaPgmq: StableId = { kind: "schema", name: "pgmq" };
const extPgmq: StableId = { kind: "extension", name: "pgmq" };
const queueTable: StableId = {
  kind: "table",
  schema: "pgmq",
  name: "q_orders",
};
const queueColumn: StableId = {
  kind: "column",
  schema: "pgmq",
  table: "q_orders",
  name: "msg_id",
};
const userTable: StableId = { kind: "table", schema: "public", name: "orders" };

function makeFact(
  id: StableId,
  payload: Payload = {},
  parent?: StableId,
): Fact {
  return parent ? { id, parent, payload } : { id, payload };
}

/** Source: the live DB — pgmq installed, with a `q_orders` queue table the
 *  extension owns (tagged `memberOfExtension`) alongside a user table. */
function sourceBase() {
  const facts: Fact[] = [
    makeFact(schemaPublic),
    makeFact(schemaPgmq),
    makeFact(extPgmq, {}, schemaPgmq),
    makeFact(queueTable, { persistence: "p" }, schemaPgmq),
    makeFact(queueColumn, { type: "bigint" }, queueTable),
    makeFact(userTable, { persistence: "p" }, schemaPublic),
  ];
  const edges: DependencyEdge[] = [
    { from: queueTable, to: extPgmq, kind: "memberOfExtension" },
  ];
  return buildFactBase(facts, edges);
}

/** Desired: the declarative source — only the user table + the extension are
 *  declared; the queue table is created by pgmq at runtime, so it is absent. */
function desiredBase() {
  const facts: Fact[] = [
    makeFact(schemaPublic),
    makeFact(schemaPgmq),
    makeFact(extPgmq, {}, schemaPgmq),
    makeFact(userTable, { persistence: "p" }, schemaPublic),
  ];
  return buildFactBase(facts, []);
}

const removesQueue = (deltas: ReturnType<typeof diff>) =>
  deltas.some(
    (d) => d.verb === "remove" && encodeId(d.fact.id) === encodeId(queueTable),
  );

describe("excludeExtensionMembers — provenance flip default projection (4b)", () => {
  test("control: a raw diff DROPS the extension-owned queue table", () => {
    // proves the scenario reproduces the destructive drop the projection prevents
    expect(removesQueue(diff(sourceBase(), desiredBase()))).toBe(true);
  });

  test("excluding members removes the queue table + its descendants", () => {
    const pruned = excludeExtensionMembers(sourceBase());
    expect(pruned.has(queueTable)).toBe(false);
    expect(pruned.has(queueColumn)).toBe(false); // descendant pruned too
  });

  test("the extension, its schema, and unrelated user objects survive", () => {
    const pruned = excludeExtensionMembers(sourceBase());
    expect(pruned.has(extPgmq)).toBe(true);
    expect(pruned.has(schemaPgmq)).toBe(true);
    expect(pruned.has(userTable)).toBe(true);
    expect(pruned.has(schemaPublic)).toBe(true);
  });

  test("a fact base with no memberOfExtension edges is returned unchanged", () => {
    const fb = desiredBase();
    expect(excludeExtensionMembers(fb)).toBe(fb); // same instance (early exit)
  });

  test("after exclusion on both sides, the diff no longer drops the queue table", () => {
    const deltas = diff(
      excludeExtensionMembers(sourceBase()),
      excludeExtensionMembers(desiredBase()),
    );
    expect(removesQueue(deltas)).toBe(false);
  });

  test("a NON-member table absent from desired is still dropped (no false suppression)", () => {
    const src = buildFactBase(
      [
        makeFact(schemaPublic),
        makeFact(userTable, { persistence: "p" }, schemaPublic),
      ],
      [],
    );
    const desired = buildFactBase([makeFact(schemaPublic)], []);
    const deltas = diff(
      excludeExtensionMembers(src),
      excludeExtensionMembers(desired),
    );
    const dropsUser = deltas.some(
      (d) => d.verb === "remove" && encodeId(d.fact.id) === encodeId(userTable),
    );
    expect(dropsUser).toBe(true);
  });
});
