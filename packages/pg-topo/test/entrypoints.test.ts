import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import * as BunApi from "../src/bun.ts";
import * as EffectApi from "../src/effect.ts";
import * as RootApi from "../src/index.ts";
import * as NodeApi from "../src/node.ts";

describe("@supabase/pg-topo entrypoints", () => {
  test("root entrypoint matches the Effect-native API", async () => {
    expect(RootApi.analyzeAndSort).toBe(EffectApi.analyzeAndSort);
    expect(RootApi.validateSqlSyntax).toBe(EffectApi.validateSqlSyntax);

    const result = await RootApi.analyzeAndSort(["SELECT 1;"]).pipe(
      Effect.provide(EffectApi.ParserServiceLive),
      Effect.runPromise,
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.ordered).toHaveLength(1);
  });

  test("node and bun entrypoints keep Promise facades", async () => {
    await expect(NodeApi.validateSqlSyntax("SELECT 1;")).resolves.toBeUndefined();
    await expect(BunApi.validateSqlSyntax("SELECT 1;")).resolves.toBeUndefined();
  });
});
