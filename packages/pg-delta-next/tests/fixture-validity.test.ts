/**
 * Fixture-validity layer (stage 0): every scenario's DDL applies cleanly.
 * Green from day one — proves the corpus itself is sound, so engine reds
 * can only ever mean "engine missing/broken", never "fixture broken".
 */
import { describe, expect, test } from "bun:test";
import { loadCorpus } from "./corpus.ts";
import { createTestDb } from "./containers.ts";

describe("corpus fixture validity", () => {
  for (const scenario of loadCorpus()) {
    test(
      scenario.name,
      async () => {
        const dbA = await createTestDb(`fv_a`);
        const dbB = await createTestDb(`fv_b`);
        try {
          await dbA.pool.query(scenario.a);
          await dbB.pool.query(scenario.b);
          if (scenario.seed) await dbA.pool.query(scenario.seed);
          expect(true).toBe(true);
        } finally {
          await Promise.all([dbA.drop(), dbB.drop()]);
        }
      },
      60_000,
    );
  }
});
