import { describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import { extractProcedures, Procedure } from "./procedure.model.ts";

const baseRow = {
  schema: "public",
  kind: "f" as const,
  return_type: "integer",
  return_type_schema: "pg_catalog",
  language: "sql",
  security_definer: false,
  volatility: "v" as const,
  parallel_safety: "u" as const,
  execution_cost: 100,
  result_rows: 0,
  is_strict: false,
  leakproof: false,
  returns_set: false,
  argument_count: 0,
  argument_default_count: 0,
  argument_names: null,
  argument_types: null,
  all_argument_types: null,
  argument_modes: null,
  argument_defaults: null,
  source_code: "select 1",
  binary_path: null,
  sql_body: null,
  config: null,
  owner: "postgres",
  comment: null,
  privileges: [],
};

const mockPool = (rows: unknown[]): Pool =>
  ({ query: async () => ({ rows }) }) as unknown as Pool;

const mockPoolSequence = (...attempts: unknown[][]): Pool => {
  let i = 0;
  return {
    query: async () => ({
      rows: attempts[Math.min(i++, attempts.length - 1)],
    }),
  } as unknown as Pool;
};

const NO_BACKOFF = { backoffMs: 0 } as const;

describe("extractProcedures", () => {
  test("skips rows where pg_get_functiondef returned NULL after exhausting retries", async () => {
    const procs = await extractProcedures(
      mockPool([
        {
          ...baseRow,
          name: '"good_fn"',
          definition:
            "CREATE OR REPLACE FUNCTION good_fn() RETURNS integer AS $$ select 1 $$ LANGUAGE sql;",
        },
        { ...baseRow, name: '"orphan_fn"', definition: null },
      ]),
      NO_BACKOFF,
    );

    expect(procs).toHaveLength(1);
    expect(procs[0]).toBeInstanceOf(Procedure);
    expect(procs[0]?.name).toBe('"good_fn"');
  });

  test("does not throw ZodError when the only row has a null definition", async () => {
    await expect(
      extractProcedures(
        mockPool([{ ...baseRow, name: '"orphan"', definition: null }]),
        NO_BACKOFF,
      ),
    ).resolves.toEqual([]);
  });

  test("returns all procedures when every row has a valid definition", async () => {
    const procs = await extractProcedures(
      mockPool([
        {
          ...baseRow,
          name: '"a"',
          definition:
            "CREATE OR REPLACE FUNCTION a() RETURNS integer AS $$ select 1 $$ LANGUAGE sql;",
        },
        {
          ...baseRow,
          name: '"b"',
          definition:
            "CREATE OR REPLACE FUNCTION b() RETURNS integer AS $$ select 2 $$ LANGUAGE sql;",
        },
      ]),
      NO_BACKOFF,
    );
    expect(procs.map((p) => p.name)).toEqual(['"a"', '"b"']);
  });

  test("recovers when pg_get_functiondef is NULL on first attempt but resolved on retry", async () => {
    const procs = await extractProcedures(
      mockPoolSequence(
        [{ ...baseRow, name: '"racy_fn"', definition: null }],
        [
          {
            ...baseRow,
            name: '"racy_fn"',
            definition:
              "CREATE OR REPLACE FUNCTION racy_fn() RETURNS integer AS $$ select 1 $$ LANGUAGE sql;",
          },
        ],
      ),
      { retries: 2, backoffMs: 0 },
    );
    expect(procs).toHaveLength(1);
    expect(procs[0]?.name).toBe('"racy_fn"');
  });
});
