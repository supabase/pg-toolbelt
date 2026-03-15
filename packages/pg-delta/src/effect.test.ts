import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { Pool } from "pg";
import * as EffectApi from "./effect.ts";

type ExpectNever<T extends never> = T;

type _CatalogInputDoesNotExposePool = ExpectNever<
  Extract<EffectApi.CatalogInput, Pool>
>;
type _ApplyPlanDoesNotExposePool = ExpectNever<
  Extract<Parameters<typeof EffectApi.applyPlan>[1], Pool>
>;

describe("@supabase/pg-delta/effect", () => {
  test("createPlan returns null for identical catalogs", async () => {
    const catalog = await Effect.runPromise(
      EffectApi.createEmptyCatalog(17, "postgres"),
    );

    const result = await EffectApi.createPlan(catalog, catalog).pipe(
      Effect.runPromise,
    );

    expect(result).toBeNull();
  });

  test("applyDeclarativeSchema handles empty content without database access", async () => {
    const result = await EffectApi.applyDeclarativeSchema({
      content: [],
    }).pipe(Effect.runPromise);

    expect(result.totalStatements).toBe(0);
    expect(result.apply.status).toBe("success");
    expect(result.apply.totalRounds).toBe(0);
  });
});
