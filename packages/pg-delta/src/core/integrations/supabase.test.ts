import { describe, expect, test } from "bun:test";
import type { Change } from "../change.types.ts";
import { evaluatePattern } from "./filter/dsl.ts";
import { supabase } from "./supabase.ts";

/**
 * Build a synthetic FDW change shaped like what `flattenChange` consumes.
 * The change carries a `foreignDataWrapper` model whose `handler`/`validator`
 * are schema-qualified function references (the form
 * `extractForeignDataWrappers` produces).
 */
function fdwChange(
  operation: "create" | "alter" | "drop",
  fdw: {
    name: string;
    owner: string;
    handler: string | null;
    validator: string | null;
  },
): Change {
  return {
    objectType: "foreign_data_wrapper",
    operation,
    scope: "object",
    foreignDataWrapper: fdw,
    requires: [],
    creates: [],
    drops: [],
  } as unknown as Change;
}

describe("supabase integration filter — foreign data wrappers", () => {
  if (!supabase.filter) {
    throw new Error("supabase integration is missing a filter");
  }
  const filter = supabase.filter;

  // Regression for CLI-1470. Wasm-based foreign data wrappers on Supabase
  // (e.g. `clerk`, `clerk_oauth`) are provisioned at project creation by
  // `supabase_admin` and their handler/validator live in `extensions.*`.
  // pg-delta must not emit `CREATE/DROP/ALTER FOREIGN DATA WRAPPER` for
  // them, even when the FDW owner has been rewritten away from
  // `supabase_admin` (e.g. after a dump/restore).
  test("suppresses CREATE for FDW with handler in extensions schema", () => {
    const change = fdwChange("create", {
      name: "clerk",
      owner: "postgres",
      handler: "extensions.wasm_fdw_handler",
      validator: "extensions.wasm_fdw_validator",
    });
    expect(evaluatePattern(filter, change)).toBe(false);
  });

  test("suppresses DROP for FDW with handler in extensions schema", () => {
    const change = fdwChange("drop", {
      name: "clerk_oauth",
      owner: "postgres",
      handler: "extensions.wasm_fdw_handler",
      validator: "extensions.wasm_fdw_validator",
    });
    expect(evaluatePattern(filter, change)).toBe(false);
  });

  test("suppresses ALTER for FDW with handler in extensions schema", () => {
    const change = fdwChange("alter", {
      name: "clerk",
      owner: "postgres",
      handler: "extensions.wasm_fdw_handler",
      validator: "extensions.wasm_fdw_validator",
    });
    expect(evaluatePattern(filter, change)).toBe(false);
  });

  test("suppresses FDW when only the validator lives in extensions", () => {
    const change = fdwChange("create", {
      name: "partial_wasm",
      owner: "postgres",
      handler: null,
      validator: "extensions.wasm_fdw_validator",
    });
    expect(evaluatePattern(filter, change)).toBe(false);
  });

  test("preserves user FDW whose handler lives outside extensions", () => {
    const change = fdwChange("create", {
      name: "user_fdw",
      owner: "postgres",
      handler: "public.my_fdw_handler",
      validator: "public.my_fdw_validator",
    });
    expect(evaluatePattern(filter, change)).toBe(true);
  });

  test("preserves user FDW with no handler/validator", () => {
    const change = fdwChange("create", {
      name: "user_fdw_bare",
      owner: "postgres",
      handler: null,
      validator: null,
    });
    expect(evaluatePattern(filter, change)).toBe(true);
  });
});
