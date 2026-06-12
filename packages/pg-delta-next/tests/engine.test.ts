/**
 * The engine suite (stage 0 + stage 3): every corpus scenario through the
 * proof loop, in BOTH directions — apply(plan(A→B), clone(A)) must be
 * hash-identical to B, and seeded rows must survive in surviving tables.
 */
import { describe, test } from "bun:test";
import { encodeId } from "../src/core/stable-id.ts";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { provePlan } from "../src/proof/prove.ts";
import { loadCorpus } from "./corpus.ts";
import { createTestDb } from "./containers.ts";

async function proveDirection(
  name: string,
  fromSql: string,
  toSql: string,
  seed: string | undefined,
): Promise<void> {
  const source = await createTestDb("src");
  const desired = await createTestDb("dst");
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
    try {
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
        throw new Error(
          `[${name}] proof failed\ndrift:\n${drift}\ndata:\n${data}\nplan:\n${planText}`,
        );
      }
    } finally {
      await clone.drop();
    }
  } finally {
    await Promise.all([source.drop(), desired.drop()]);
  }
}

describe("engine: corpus proof loop", () => {
  for (const scenario of loadCorpus()) {
    test(`${scenario.name} (a -> b)`, async () => {
      await proveDirection(
        scenario.name,
        scenario.a,
        scenario.b,
        scenario.seed,
      );
    }, 120_000);

    test(`${scenario.name} (b -> a, teardown direction)`, async () => {
      await proveDirection(
        `${scenario.name}:reverse`,
        scenario.b,
        scenario.a,
        undefined,
      );
    }, 120_000);
  }
});
