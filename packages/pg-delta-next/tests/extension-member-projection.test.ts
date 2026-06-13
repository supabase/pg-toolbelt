/**
 * provePlan() applies the default extension-member projection to the proven
 * re-extract (4b Stage 0). Docker required (a sacrificial clone pool).
 *
 * The proof re-extracts the clone after applying and diffs it against the
 * (projected) target. Post-flip, that re-extract will observe extension members
 * — they must be projected OUT of `proven` too, or every extension's internals
 * would read as drift. This test injects a member through the `reextract` hook
 * (the designed extension point, the same shape the flipped extractor will
 * produce) so the prove-side wiring is pinned independently of Stage 2.
 */
import { describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import {
  buildFactBase,
  type DependencyEdge,
  type Fact,
  type FactBase,
} from "../src/core/fact.ts";
import type { StableId } from "../src/core/stable-id.ts";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { provePlan } from "../src/proof/prove.ts";
import { createTestDb } from "./containers.ts";

const extSynth: StableId = { kind: "extension", name: "synth_ext" };
const memberTable: StableId = {
  kind: "table",
  schema: "public",
  name: "synth_member",
};
const schemaPublic: StableId = { kind: "schema", name: "public" };

describe("provePlan — default extension-member projection (4b Stage 0)", () => {
  test("extension members in the proven re-extract are not reported as drift", async () => {
    const db = await createTestDb("prove_member");
    try {
      await db.pool.query("CREATE TABLE public.keep (id integer PRIMARY KEY)");
      const state = await extract(db.pool);

      // empty plan: source == desired, so applying it to the clone is a no-op
      const emptyPlan = plan(state.factBase, state.factBase);
      expect(emptyPlan.actions).toHaveLength(0);

      // the comparison target: real state + a synthetic extension fact. The
      // extension is on BOTH sides so ONLY the member differs — isolating the
      // member-exclusion behaviour from anything else.
      const extFact: Fact = { id: extSynth, payload: {} };
      const desired = buildFactBase(
        [...state.factBase.facts(), extFact],
        [...state.factBase.edges],
        state.factBase.source,
      );

      // reextract simulates the POST-FLIP extractor: the same real state, plus
      // the extension fact and an extension-OWNED member tagged memberOfExtension
      const reextract = async (pool: Pool): Promise<{ factBase: FactBase }> => {
        const real = await extract(pool);
        const facts: Fact[] = [
          ...real.factBase.facts(),
          extFact,
          {
            id: memberTable,
            parent: schemaPublic,
            payload: { persistence: "p" },
          },
        ];
        const edges: DependencyEdge[] = [
          ...real.factBase.edges,
          { from: memberTable, to: extSynth, kind: "memberOfExtension" },
        ];
        return { factBase: buildFactBase(facts, edges, real.factBase.source) };
      };

      const verdict = await provePlan(emptyPlan, db.pool, desired, {
        reextract,
      });

      // RED before wiring: the member reads as drift (remove synth_member).
      // GREEN after wiring: members are projected out of `proven` → no drift.
      expect(verdict.driftDeltas).toHaveLength(0);
      expect(verdict.ok).toBe(true);
    } finally {
      await db.drop();
    }
  }, 60_000);
});
