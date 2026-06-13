/**
 * Stage-10 differential harness: run the same scenarios through BOTH the new
 * engine (packages/pg-delta-next) and the old engine (packages/pg-delta) and
 * bucket any divergences.
 *
 * Bucket taxonomy
 * ───────────────
 * "both-converge"             both engines reach desired rootHash  ← expected
 * "old-fails-new-converges"   old engine failed, new succeeded     ← LOG only (old gap)
 * "new-fails-old-converges"   new engine failed, old succeeded     ← TEST FAILURE (regression)
 * "accepted-difference-acl"   hashes differ but ALL drift is acl-kind ← LOG only
 * "both-fail"                 both engines failed                   ← LOG only
 *
 * Scenario selection (FORWARD direction only, non-isolatedCluster scenarios)
 * ─────────────────────────────────────────────────────────────────────────
 * Default subset: scenarios whose names start with one of:
 *   table-ops, view-operations, catalog-diff, type-ops,
 *   function-ops, sequence-operations
 * Override: PGDELTA_NEXT_DIFFERENTIAL=all  runs every non-isolated scenario.
 *
 * The PGDELTA_NEXT_ONLY filter (from corpus.ts) is respected if set.
 *
 * OLD ENGINE NOTE
 * ───────────────
 * The old engine (packages/pg-delta) is imported via a relative path because
 * @supabase/pg-delta is NOT listed as a dependency of packages/pg-delta-next
 * (and therefore does not resolve via bare specifier under bun test).  The
 * relative-path import is intentional and documented here.
 *
 * The old engine's applyPlan(plan, source, target) executes plan.statements
 * against the `source` pool (the clone); `target` is the desired-state pool
 * used only for fingerprint / post-apply verification.
 *
 * ACL CAVEAT
 * ──────────
 * The old engine does not always normalise acldefault(), so its rootHash may
 * differ from the new engine's rootHash even after a successful plan.  When
 * the old clone's hash mismatches the desired state we additionally compare
 * via diff() and check whether every drift delta is of kind "acl".  If so
 * the divergence is bucketed as "accepted-difference-acl" rather than a
 * failure.
 */

import { describe, test } from "bun:test";
import { apply } from "../src/apply/apply.ts";
import { diff } from "../src/core/diff.ts";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { loadCorpus, type Scenario } from "./corpus.ts";
import { sharedCluster, type Cluster } from "./containers.ts";

// ── old engine (via wrapper; @supabase/pg-delta is not in our deps) ──────────
// tests/old-engine.ts dynamically imports ../../pg-delta/src/index.ts at
// runtime (Bun resolves it; TypeScript cannot without tsconfig path changes).
import {
  createPlan as oldCreatePlan,
  applyPlan as oldApplyPlan,
} from "./old-engine.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Scenario filtering
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PREFIXES = [
  "table-ops",
  "view-operations",
  "catalog-diff",
  "type-ops",
  "function-ops",
  "sequence-operations",
];

function selectDifferentialScenarios(scenarios: Scenario[]): Scenario[] {
  const runAll =
    (process.env["PGDELTA_NEXT_DIFFERENTIAL"] ?? "").toLowerCase() === "all";
  return scenarios.filter((s) => {
    if (s.meta.isolatedCluster === true) return false;
    if (runAll) return true;
    return DEFAULT_PREFIXES.some((p) => s.name.startsWith(p));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Bucket types
// ─────────────────────────────────────────────────────────────────────────────

type Bucket =
  | "both-converge"
  | "old-fails-new-converges"
  | "new-fails-old-converges"
  | "accepted-difference-acl"
  | "both-fail";

interface BucketEntry {
  scenario: string;
  bucket: Bucket;
  note?: string;
}

// Shared accumulator — populated by individual tests, printed in afterAll-like
// mechanism by a final summary test (guaranteed-last via name ordering).
const results: BucketEntry[] = [];

// ─────────────────────────────────────────────────────────────────────────────
// Core: run one scenario through BOTH engines
// ─────────────────────────────────────────────────────────────────────────────

async function runDifferential(
  scenario: Scenario,
  cluster: Cluster,
): Promise<BucketEntry> {
  const source = await cluster.createDb("diff_src");
  const desired = await cluster.createDb("diff_dst");

  try {
    await source.pool.query(scenario.a);
    await desired.pool.query(scenario.b);
    if (scenario.seed) await source.pool.query(scenario.seed);

    // Extract once with the NEW engine — used as the reference measurer
    const [sourceState, desiredState] = await Promise.all([
      extract(source.pool),
      extract(desired.pool),
    ]);
    const desiredHash = desiredState.factBase.rootHash;

    // We need two independent clones of source: one for the new engine,
    // one for the old engine.  CREATE DATABASE … TEMPLATE closes all
    // connections on the source, then reopens them.
    const cloneNew = await source.clone();
    // source is now reopened; clone again
    const cloneOld = await source.clone();

    let newConverges = false;
    let oldConverges = false;
    let oldAclDriftOnly = false;
    let newNote: string | undefined;
    let oldNote: string | undefined;

    try {
      // ── NEW ENGINE PATH ───────────────────────────────────────────────────
      try {
        const thePlan = plan(sourceState.factBase, desiredState.factBase);

        // presync clone if TEMPLATE skipped subscription state
        const cloneNewState = await extract(cloneNew.pool);
        if (cloneNewState.factBase.rootHash !== sourceState.factBase.rootHash) {
          const presync = plan(cloneNewState.factBase, sourceState.factBase);
          const presyncResult = await apply(presync, cloneNew.pool, {
            fingerprintGate: false,
          });
          if (presyncResult.status !== "applied") {
            throw new Error(
              `new engine clone presync failed: ${presyncResult.error?.message ?? "unknown"}`,
            );
          }
        }

        const applyResult = await apply(thePlan, cloneNew.pool, {
          fingerprintGate: false,
        });
        if (applyResult.status !== "applied") {
          newNote = `apply failed at action ${applyResult.error?.actionIndex ?? "?"}: ${applyResult.error?.message ?? "unknown"}`;
        } else {
          const afterState = await extract(cloneNew.pool);
          newConverges = afterState.factBase.rootHash === desiredHash;
          if (!newConverges) {
            const driftDeltas = diff(
              afterState.factBase,
              desiredState.factBase,
            );
            newNote = `hash mismatch after apply; ${driftDeltas.length} drift delta(s)`;
          }
        }
      } catch (err) {
        newNote = err instanceof Error ? err.message : String(err);
      }

      // ── OLD ENGINE PATH ───────────────────────────────────────────────────
      try {
        const oldResult = await oldCreatePlan(cloneOld.pool, desired.pool);
        if (oldResult === null) {
          // null means no differences → already converged
          const afterOldState = await extract(cloneOld.pool);
          oldConverges = afterOldState.factBase.rootHash === desiredHash;
          if (!oldConverges) {
            oldNote = "oldCreatePlan returned null but hashes still differ";
          }
        } else {
          const applyOldResult = await oldApplyPlan(
            oldResult.plan,
            cloneOld.pool,
            desired.pool,
            { verifyPostApply: false },
          );
          if (
            applyOldResult.status !== "applied" &&
            applyOldResult.status !== "already_applied"
          ) {
            oldNote = `old applyPlan status=${applyOldResult.status}`;
            if (applyOldResult.status === "failed") {
              oldNote = `old apply failed: ${String((applyOldResult as { error: unknown }).error)}`;
            } else if (applyOldResult.status === "fingerprint_mismatch") {
              const mm = applyOldResult as {
                current: string;
                expected: string;
              };
              oldNote = `old fingerprint_mismatch current=${mm.current.slice(0, 8)} expected=${mm.expected.slice(0, 8)}`;
            }
          } else {
            // Adjudicate with NEW extractor
            const afterOldState = await extract(cloneOld.pool);
            if (afterOldState.factBase.rootHash === desiredHash) {
              oldConverges = true;
            } else {
              // Check whether ALL drift is acl-kind only
              const driftDeltas = diff(
                afterOldState.factBase,
                desiredState.factBase,
              );
              const allAcl = driftDeltas.every(
                (d) =>
                  (d.verb === "add" || d.verb === "remove"
                    ? d.fact.id.kind
                    : d.verb === "set"
                      ? d.id.kind
                      : d.verb === "link" || d.verb === "unlink"
                        ? d.edge.from.kind
                        : "unknown") === "acl",
              );
              if (allAcl && driftDeltas.length > 0) {
                oldAclDriftOnly = true;
              }
              oldNote = `hash mismatch; ${driftDeltas.length} drift delta(s)${allAcl ? " (all acl-kind)" : ""}`;
            }
          }
        }
      } catch (err) {
        oldNote = err instanceof Error ? err.message : String(err);
      }
    } finally {
      await Promise.all([cloneNew.drop(), cloneOld.drop()]);
    }

    // ── Adjudication ─────────────────────────────────────────────────────────
    let bucket: Bucket;
    if (newConverges && oldConverges) {
      bucket = "both-converge";
    } else if (newConverges && !oldConverges) {
      if (oldAclDriftOnly) {
        bucket = "accepted-difference-acl";
      } else {
        bucket = "old-fails-new-converges";
      }
    } else if (!newConverges && oldConverges) {
      bucket = "new-fails-old-converges";
    } else {
      // both fail
      if (oldAclDriftOnly && !newConverges) {
        // old "almost" converged but new failed too — still both-fail
        bucket = "both-fail";
      } else {
        bucket = "both-fail";
      }
    }

    const noteParts = [
      newNote ? `new: ${newNote}` : null,
      oldNote ? `old: ${oldNote}` : null,
    ].filter((x): x is string => x !== null);
    const noteStr = noteParts.join("; ");

    return noteStr
      ? { scenario: scenario.name, bucket, note: noteStr }
      : { scenario: scenario.name, bucket };
  } finally {
    await Promise.all([source.drop(), desired.drop()]);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Test registration
// ─────────────────────────────────────────────────────────────────────────────

const corpusScenarios = loadCorpus();
const scenarios = selectDifferentialScenarios(corpusScenarios);

describe("differential: new vs old engine", () => {
  for (const scenario of scenarios) {
    test(`${scenario.name} (forward)`, async () => {
      const cluster = await sharedCluster();
      if (scenario.meta.minVersion !== undefined) {
        if ((await cluster.pgMajor()) < (scenario.meta.minVersion ?? 0)) {
          results.push({
            scenario: scenario.name,
            bucket: "both-converge",
            note: `skipped: minVersion ${String(scenario.meta.minVersion)}`,
          });
          return;
        }
      }

      const entry = await runDifferential(scenario, cluster);
      results.push(entry);

      if (entry.bucket === "new-fails-old-converges") {
        throw new Error(
          `[${scenario.name}] NEW engine regression — old engine converged but new engine did not.\n` +
            (entry.note ?? ""),
        );
      }

      // Non-failing buckets: log to stdout for visibility
      if (entry.bucket !== "both-converge") {
        console.log(
          `[differential] ${scenario.name}: ${entry.bucket}${entry.note ? ` — ${entry.note}` : ""}`,
        );
      }
    }, 180_000);
  }

  // The summary test runs LAST (alphabetically "~" sorts after all letters
  // and digits; bun:test runs tests in registration order within a
  // describe block, so we register it at the end).
  test("~summary", () => {
    const counts: Record<Bucket, number> = {
      "both-converge": 0,
      "old-fails-new-converges": 0,
      "new-fails-old-converges": 0,
      "accepted-difference-acl": 0,
      "both-fail": 0,
    };
    for (const entry of results) {
      counts[entry.bucket]++;
    }

    const NON_CONVERGE_BUCKETS: Bucket[] = [
      "old-fails-new-converges",
      "new-fails-old-converges",
      "accepted-difference-acl",
      "both-fail",
    ];

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("  DIFFERENTIAL HARNESS SUMMARY");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`  both-converge            : ${counts["both-converge"]}`);
    console.log(
      `  old-fails-new-converges  : ${counts["old-fails-new-converges"]}`,
    );
    console.log(
      `  new-fails-old-converges  : ${counts["new-fails-old-converges"]}`,
    );
    console.log(
      `  accepted-difference-acl  : ${counts["accepted-difference-acl"]}`,
    );
    console.log(`  both-fail                : ${counts["both-fail"]}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    for (const bucket of NON_CONVERGE_BUCKETS) {
      const entries = results.filter((e) => e.bucket === bucket);
      if (entries.length === 0) continue;
      console.log(`\n  ${bucket}:`);
      for (const e of entries) {
        console.log(`    - ${e.scenario}${e.note ? ` (${e.note})` : ""}`);
      }
    }
    console.log("");
  }, 10_000);
});
