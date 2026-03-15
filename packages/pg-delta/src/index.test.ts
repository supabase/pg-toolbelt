import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import * as BunApi from "./bun.ts";
import * as EffectApi from "./effect.ts";
import * as RootApi from "./index.ts";
import * as NodeApi from "./node.ts";

describe("@supabase/pg-delta entrypoints", () => {
  test("root entrypoint matches the Effect-native API", async () => {
    expect(RootApi.createPlan).toBe(EffectApi.createPlan);
    expect(RootApi.applyPlan).toBe(EffectApi.applyPlan);

    const catalog = await Effect.runPromise(
      RootApi.createEmptyCatalog(170000, "postgres"),
    );
    const result = await RootApi.createPlan(catalog, catalog).pipe(
      Effect.runPromise,
    );

    expect(result).toBeNull();
  });

  test("node and bun entrypoints keep Promise facades", async () => {
    const catalog = await Effect.runPromise(
      EffectApi.createEmptyCatalog(170000, "postgres"),
    );

    await expect(NodeApi.createPlan(catalog, catalog)).resolves.toBeNull();
    await expect(BunApi.createPlan(catalog, catalog)).resolves.toBeNull();
  });
});
