/**
 * The engine suite (stage 0 + stage 3): every corpus scenario through the
 * proof loop, in BOTH directions. Cluster-level scenarios (meta.isolatedCluster)
 * place state A and state B on separate clusters with role cleanup.
 * EXPECTED_RED pins scenarios whose engine support hasn't landed: a pinned
 * test must fail; a pinned test that passes fails the suite.
 */
import { describe, test } from "bun:test";
import { apply } from "../src/apply/apply.ts";
import { encodeId } from "../src/core/stable-id.ts";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { provePlan } from "../src/proof/prove.ts";
import { loadCorpus, type Scenario } from "./corpus.ts";
import {
  isolatedClusterPair,
  sharedCluster,
  type Cluster,
} from "./containers.ts";
import { EXPECTED_RED } from "./expected-red.ts";

async function proveOn(
  name: string,
  clusterA: Cluster,
  clusterB: Cluster,
  fromSql: string,
  toSql: string,
  seed: string | undefined,
): Promise<void> {
  const source = await clusterA.createDb("src");
  const desired = await clusterB.createDb("dst");
  try {
    await source.pool.query(fromSql);
    await desired.pool.query(toSql);
    if (seed) await source.pool.query(seed);

    const [sourceState, desiredState] = [
      await extract(source.pool),
      await extract(desired.pool),
    ];
    const thePlan = plan(sourceState.factBase, desiredState.factBase);

    const clone = await source.clone();
    // the original source DB would block cluster-wide DROP ROLE actions
    // (the role still owns its objects there); the clone is the proof target
    await source.drop();
    try {
      // TEMPLATE cloning skips shared-catalog state (subscriptions): presync
      // the clone to the source's fact base before proving the real plan
      const cloneState = await extract(clone.pool);
      if (cloneState.factBase.rootHash !== sourceState.factBase.rootHash) {
        const presync = plan(cloneState.factBase, sourceState.factBase);
        const presyncReport = await apply(presync, clone.pool, {
          fingerprintGate: false,
        });
        if (presyncReport.status !== "applied") {
          throw new Error(
            `[${name}] clone presync failed: ${presyncReport.error?.message}`,
          );
        }
      }
      const verdict = await provePlan(
        thePlan,
        clone.pool,
        desiredState.factBase,
      );
      if (!verdict.ok) {
        const planText = thePlan.actions
          .map((a, i) => `  ${i}: ${a.sql}`)
          .join("\n");
        if (verdict.applyError) {
          throw new Error(
            `[${name}] apply failed at action ${verdict.applyError.actionIndex}: ${verdict.applyError.message}\n${planText}`,
          );
        }
        const drift = verdict.driftDeltas
          .map((d) =>
            d.verb === "set"
              ? `  set ${encodeId(d.id)}.${d.attr}: ${JSON.stringify(d.from)} -> ${JSON.stringify(d.to)}`
              : d.verb === "add" || d.verb === "remove"
                ? `  ${d.verb} ${encodeId(d.fact.id)}`
                : `  ${d.verb} ${encodeId(d.edge.from)} -> ${encodeId(d.edge.to)}`,
          )
          .join("\n");
        const data = verdict.dataViolations
          .map((v) => `  ${v.table}: ${v.before} -> ${v.after} rows`)
          .join("\n");
        const rewrites = verdict.rewriteViolations
          .map(
            (v) => `  ${v.table}: relfilenode changed, no rewriteRisk declared`,
          )
          .join("\n");
        throw new Error(
          `[${name}] proof failed\ndrift:\n${drift}\ndata:\n${data}\nrewrites:\n${rewrites}\nplan:\n${planText}`,
        );
      }
    } finally {
      await clone.drop();
    }
  } finally {
    await Promise.all([source.drop(), desired.drop()]);
  }
}

async function runDirection(
  scenario: Scenario,
  direction: "forward" | "reverse",
): Promise<void> {
  const [fromSql, toSql, seed] =
    direction === "forward"
      ? [scenario.a, scenario.b, scenario.seed]
      : [scenario.b, scenario.a, undefined];
  const label =
    direction === "forward" ? scenario.name : `${scenario.name}:reverse`;

  if (scenario.meta.isolatedCluster) {
    const [clusterA, clusterB] = await isolatedClusterPair();
    if (scenario.meta.minVersion !== undefined) {
      if ((await clusterA.pgMajor()) < scenario.meta.minVersion) return;
    }
    const [baseA, baseB] = await Promise.all([
      clusterA.listRoles(),
      clusterB.listRoles(),
    ]);
    try {
      await proveOn(label, clusterA, clusterB, fromSql, toSql, seed);
    } finally {
      await Promise.all([
        clusterA.dropRolesExcept(baseA),
        clusterB.dropRolesExcept(baseB),
      ]);
    }
    return;
  }

  const cluster = await sharedCluster();
  if (scenario.meta.minVersion !== undefined) {
    if ((await cluster.pgMajor()) < scenario.meta.minVersion) return;
  }
  await proveOn(label, cluster, cluster, fromSql, toSql, seed);
}

async function runPinnedOrProve(
  scenario: Scenario,
  direction: "forward" | "reverse",
): Promise<void> {
  const key =
    direction === "forward" ? scenario.name : `${scenario.name}:reverse`;
  const pinned = EXPECTED_RED.has(key) || EXPECTED_RED.has(scenario.name);
  if (!pinned) {
    await runDirection(scenario, direction);
    return;
  }
  try {
    await runDirection(scenario, direction);
  } catch {
    return; // red as pinned — fine
  }
  throw new Error(
    `${key} is pinned in EXPECTED_RED but now PASSES — remove the pin (tests/expected-red.ts)`,
  );
}

describe("engine: corpus proof loop", () => {
  for (const scenario of loadCorpus()) {
    test(`${scenario.name} (a -> b)`, async () => {
      await runPinnedOrProve(scenario, "forward");
    }, 180_000);

    test(`${scenario.name} (b -> a, teardown direction)`, async () => {
      await runPinnedOrProve(scenario, "reverse");
    }, 180_000);
  }
});
