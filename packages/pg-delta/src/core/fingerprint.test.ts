import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { createEmptyCatalog } from "./catalog.model.ts";
import { hashStableIds } from "./fingerprint.ts";

describe("hashStableIds", () => {
  test("produces deterministic sha256 output without runtime crypto", async () => {
    const catalog = await Effect.runPromise(
      createEmptyCatalog(170000, "postgres"),
    );

    expect(hashStableIds(catalog, [])).toMatchInlineSnapshot(
      `"4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"`,
    );
  });
});
