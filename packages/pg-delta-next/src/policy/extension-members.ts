/**
 * Extension-member exclusion (docs/archive/hardening-plan.md, "Item 4b —
 * provenance flip"; target-architecture §3.1 "provenance is data, an edge fact,
 * not an extraction-time filter").
 *
 * Objects an extension OWNS — pgmq `q_*`/`a_*` queue tables, pg_cron's
 * `cron.job`, a contrib's functions/types/operators — are observed at
 * extraction as ordinary facts carrying a `memberOfExtension` edge to the
 * extension. The extension owns their lifecycle, so by default they must NOT be
 * diffed: a diff would try to drop or recreate extension internals.
 *
 * Exclusion is at the FACT level (both sides + the proof re-extract), NOT the
 * delta level — a delta-only filter would make the proof drift (the clone keeps
 * the members, `desired` lacks them). Removing them from the fact base keeps the
 * proof honest: the plan you prove == the plan you run. This is the exact
 * counterpart of `excludeManaged` (src/policy/managed.ts) — same fact-level
 * subtraction, a different provenance edge (`memberOfExtension` vs `managedBy`).
 *
 * A `memberOfExtension`-tagged fact and its entire descendant subtree (a member
 * table's columns/constraints, its ACL/comment satellites carried as children)
 * are removed; edges with a removed endpoint are pruned. Facts with no
 * `memberOfExtension` provenance are untouched, so user objects (including a
 * user-declared object that merely lives in an extension's schema) still diff
 * normally — no false suppression.
 */
import type { FactBase } from "../core/fact.ts";
import { excludeByProvenance } from "./view.ts";

/**
 * Return a new FactBase with every extension-owned fact removed: a fact carrying
 * an outgoing `memberOfExtension` edge, plus all of its descendants. Edges with
 * a removed endpoint are dropped. If nothing is a member, `fb` is returned
 * unchanged. Thin wrapper over the shared projection primitive (view.ts).
 */
export function excludeExtensionMembers(fb: FactBase): FactBase {
  return excludeByProvenance(fb, "memberOfExtension");
}
