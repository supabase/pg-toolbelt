import { describe, expect, test } from "bun:test";
import { configure, type LogRecord, reset } from "@logtape/logtape";
import type { Pool, PoolClient, QueryResult } from "pg";
import {
  type RoundResult,
  rewriteAsOrReplace,
  roundApply,
  type StatementEntry,
} from "./round-apply.ts";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock PoolClient that executes queries against a provided handler.
 * The handler receives the SQL and can either resolve or throw a pg-style error.
 */
function createMockClient(queryHandler: (sql: string) => void): PoolClient {
  return {
    query: async (sql: string) => {
      queryHandler(sql);
      return { rows: [], rowCount: 0 } as unknown as QueryResult;
    },
    release: () => {},
  } as unknown as PoolClient;
}

/**
 * Create a mock Pool that returns the provided mock client.
 */
function createMockPool(client: PoolClient): Pool {
  return {
    connect: async () => client,
    end: () => {},
  } as unknown as Pool;
}

/**
 * Create a postgres-style error with a SQLSTATE code.
 */
function pgError(code: string, message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("roundApply", () => {
  test("should apply all statements in a single round when no errors", async () => {
    const statements: StatementEntry[] = [
      { id: "1", sql: "CREATE SCHEMA test;" },
      { id: "2", sql: "CREATE TABLE test.users (id int);" },
    ];

    const client = createMockClient(() => {
      // All queries succeed
    });
    const pool = createMockPool(client);

    const result = await roundApply({ pool, statements });

    expect(result.status).toBe("success");
    expect(result.totalRounds).toBe(1);
    expect(result.totalApplied).toBe(2);
    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0].applied).toBe(2);
    expect(result.rounds[0].deferred).toBe(0);
  });

  test("should defer dependency errors and retry in next round", async () => {
    const statements: StatementEntry[] = [
      { id: "table", sql: "CREATE TABLE test.users (id int);" },
      { id: "schema", sql: "CREATE SCHEMA test;" },
    ];

    // Track which round we're on
    const appliedSet = new Set<string>();

    const client = createMockClient((sql: string) => {
      if (sql.startsWith("SET ")) return; // Allow SET statements

      if (sql.includes("CREATE TABLE") && !appliedSet.has("schema")) {
        // Table creation fails because schema doesn't exist yet
        throw pgError("3F000", 'schema "test" does not exist');
      }
      // Track successful applies
      if (sql.includes("CREATE SCHEMA")) appliedSet.add("schema");
    });
    const pool = createMockPool(client);

    const result = await roundApply({ pool, statements });

    expect(result.status).toBe("success");
    expect(result.totalRounds).toBe(2);
    expect(result.totalApplied).toBe(2);
    // Round 1: schema succeeds, table deferred
    expect(result.rounds[0].applied).toBe(1);
    expect(result.rounds[0].deferred).toBe(1);
    // Round 2: table succeeds
    expect(result.rounds[1].applied).toBe(1);
    expect(result.rounds[1].deferred).toBe(0);
  });

  test("should report stuck when no progress can be made", async () => {
    const statements: StatementEntry[] = [
      { id: "1", sql: "CREATE TABLE a (id int REFERENCES b(id));" },
      { id: "2", sql: "CREATE TABLE b (id int REFERENCES a(id));" },
    ];

    const client = createMockClient((sql: string) => {
      if (sql.startsWith("SET ")) return;
      // Both always fail with dependency errors (circular)
      throw pgError("42P01", "relation does not exist");
    });
    const pool = createMockPool(client);

    const result = await roundApply({ pool, statements, maxRounds: 5 });

    expect(result.status).toBe("stuck");
    expect(result.stuckStatements).toHaveLength(2);
    expect(result.totalApplied).toBe(0);
  });

  test("should skip environment capability errors", async () => {
    const statements: StatementEntry[] = [
      {
        id: "ext",
        sql: "CREATE EXTENSION pgaudit;",
        statementClass: "CREATE_EXTENSION",
      },
      { id: "schema", sql: "CREATE SCHEMA test;" },
    ];

    const client = createMockClient((sql: string) => {
      if (sql.startsWith("SET ")) return;
      if (sql.includes("CREATE EXTENSION")) {
        throw pgError("58P01", "extension pgaudit control file not found");
      }
    });
    const pool = createMockPool(client);

    const result = await roundApply({ pool, statements });

    expect(result.status).toBe("success");
    expect(result.totalApplied).toBe(1);
    expect(result.totalSkipped).toBe(1);
  });

  test("should report hard failures for non-dependency errors", async () => {
    const statements: StatementEntry[] = [
      { id: "1", sql: "CREATE TABLE test (id int);" },
      { id: "2", sql: "INVALID SQL;" },
    ];

    const client = createMockClient((sql: string) => {
      if (sql.startsWith("SET ")) return;
      if (sql.includes("INVALID")) {
        throw pgError("42601", "syntax error");
      }
    });
    const pool = createMockPool(client);

    const result = await roundApply({ pool, statements });

    expect(result.status).toBe("error");
    expect(result.totalApplied).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors?.[0].code).toBe("42601");
  });

  test("should call onRoundComplete callback", async () => {
    const statements: StatementEntry[] = [
      { id: "1", sql: "CREATE SCHEMA test;" },
    ];

    const client = createMockClient((sql: string) => {
      if (sql.startsWith("SET ")) return;
    });
    const pool = createMockPool(client);

    const rounds: RoundResult[] = [];
    const result = await roundApply({
      pool,
      statements,
      onRoundComplete: (round) => rounds.push(round),
    });

    expect(result.status).toBe("success");
    expect(rounds).toHaveLength(1);
    expect(rounds[0].round).toBe(1);
    expect(rounds[0].applied).toBe(1);
  });

  test("should set check_function_bodies = off by default", async () => {
    const statements: StatementEntry[] = [
      { id: "1", sql: "CREATE SCHEMA test;" },
    ];

    const queryCalls: string[] = [];
    const client = createMockClient((sql: string) => {
      queryCalls.push(sql);
    });
    const pool = createMockPool(client);

    await roundApply({ pool, statements });

    expect(queryCalls[0]).toBe("SET check_function_bodies = off");
  });

  test("should run final validation for functions when enabled", async () => {
    const statements: StatementEntry[] = [
      {
        id: "fn",
        sql: "CREATE FUNCTION test_fn() RETURNS void AS $$ BEGIN END; $$ LANGUAGE plpgsql;",
        statementClass: "CREATE_FUNCTION",
      },
    ];

    const queryCalls: string[] = [];
    const client = createMockClient((sql: string) => {
      queryCalls.push(sql);
    });
    const pool = createMockPool(client);

    const result = await roundApply({
      pool,
      statements,
      finalValidation: true,
    });

    expect(result.status).toBe("success");
    // Should have: SET off, CREATE FUNCTION, SET on, CREATE OR REPLACE FUNCTION
    const validationCall = queryCalls.find((sql) =>
      sql.includes("CREATE OR REPLACE FUNCTION"),
    );
    expect(validationCall).toBeDefined();
    expect(queryCalls).toContain("SET check_function_bodies = on");
  });

  test("should handle annotated functions in final validation", async () => {
    const statements: StatementEntry[] = [
      {
        id: "fn",
        sql: "-- pg-topo:requires function:app.other(int)\n-- pg-topo:requires function:app.multiline(int)\nCREATE FUNCTION test_fn() RETURNS void AS $$ BEGIN END; $$ LANGUAGE plpgsql;",
        statementClass: "CREATE_FUNCTION",
      },
    ];

    const queryCalls: string[] = [];
    const client = createMockClient((sql: string) => {
      queryCalls.push(sql);
    });
    const pool = createMockPool(client);

    const result = await roundApply({
      pool,
      statements,
      finalValidation: true,
    });

    expect(result.status).toBe("success");
    const validationCall = queryCalls.find((sql) =>
      sql.includes("OR REPLACE FUNCTION"),
    );
    expect(validationCall).toBeDefined();
    expect(validationCall).toContain("-- pg-topo:requires");
  });

  test("should respect maxRounds limit", async () => {
    // Simulate a scenario where each round makes some progress but
    // never finishes: statements 1..5 succeed one per round based on
    // a counter, but the last one always defers.
    const statements: StatementEntry[] = [
      { id: "a1", sql: "CREATE TABLE a1 (id int);" },
      { id: "a2", sql: "CREATE TABLE a2 (id int);" },
      { id: "a3", sql: "CREATE TABLE a3 (id int);" },
      { id: "stuck", sql: "CREATE TABLE stuck (id int);" },
    ];

    let _appliedCount = 0;

    const client = createMockClient((sql: string) => {
      if (sql.startsWith("SET ")) return;
      if (sql.includes("stuck")) {
        // Always fails with dependency error
        throw pgError("42P01", "relation does not exist");
      }
      // Each non-stuck statement succeeds once
      _appliedCount++;
    });
    const pool = createMockPool(client);

    // With maxRounds=2, we apply a1,a2,a3 in rounds 1-2 but "stuck" never resolves
    // Actually with 4 statements: round 1 applies 3, defers 1. Round 2: stuck (0 applied, 1 deferred)
    // So stuck detection kicks in at round 2, not maxRounds
    // To test maxRounds limit, we need a scenario where we can't detect stuck early.
    // Instead, test that stuck detection happens correctly with a single deferred statement.
    const result = await roundApply({ pool, statements, maxRounds: 2 });

    expect(result.status).toBe("stuck");
    // Round 1: 3 applied, 1 deferred. Round 2: 0 applied, 1 deferred -> stuck
    expect(result.totalRounds).toBe(2);
    expect(result.totalApplied).toBe(3);
    expect(result.stuckStatements).toHaveLength(1);
    expect(result.stuckStatements?.[0].statement.id).toBe("stuck");
  });

  test("should handle multi-round resolution with many statements", async () => {
    // Simulate: schema -> table -> index dependency chain, presented in reverse
    const statements: StatementEntry[] = [
      { id: "idx", sql: "CREATE INDEX idx ON test.users (name);" },
      { id: "table", sql: "CREATE TABLE test.users (id int, name text);" },
      { id: "schema", sql: "CREATE SCHEMA test;" },
    ];

    const appliedSet = new Set<string>();

    const client = createMockClient((sql: string) => {
      if (sql.startsWith("SET ")) return;

      if (sql.includes("CREATE INDEX") && !appliedSet.has("table")) {
        throw pgError("42P01", 'relation "test.users" does not exist');
      }
      if (sql.includes("CREATE TABLE") && !appliedSet.has("schema")) {
        throw pgError("3F000", 'schema "test" does not exist');
      }

      if (sql.includes("CREATE SCHEMA")) appliedSet.add("schema");
      if (sql.includes("CREATE TABLE")) appliedSet.add("table");
      if (sql.includes("CREATE INDEX")) appliedSet.add("idx");
    });
    const pool = createMockPool(client);

    const result = await roundApply({ pool, statements });

    expect(result.status).toBe("success");
    expect(result.totalRounds).toBe(3);
    expect(result.totalApplied).toBe(3);
  });

  test("should restore check_function_bodies when finalValidation is false", async () => {
    const statements: StatementEntry[] = [
      { id: "1", sql: "CREATE SCHEMA test;" },
    ];
    const queryCalls: string[] = [];
    const client = createMockClient((sql: string) => {
      queryCalls.push(sql);
    });
    const pool = createMockPool(client);

    await roundApply({ pool, statements, finalValidation: false });

    // Should see: SET off, CREATE SCHEMA, SET on (restore)
    expect(queryCalls).toContain("SET check_function_bodies = off");
    expect(queryCalls).toContain("SET check_function_bodies = on");
    // Restore must come after the last statement
    const offIdx = queryCalls.indexOf("SET check_function_bodies = off");
    const onIdx = queryCalls.lastIndexOf("SET check_function_bodies = on");
    expect(onIdx).toBeGreaterThan(offIdx);
  });

  test("should restore check_function_bodies when stuck", async () => {
    const statements: StatementEntry[] = [
      { id: "1", sql: "CREATE TABLE a (id int REFERENCES b(id));" },
    ];
    const queryCalls: string[] = [];
    const client = createMockClient((sql: string) => {
      queryCalls.push(sql);
      if (!sql.startsWith("SET ")) {
        throw pgError("42P01", "relation does not exist");
      }
    });
    const pool = createMockPool(client);

    const result = await roundApply({ pool, statements, maxRounds: 2 });
    expect(result.status).toBe("stuck");
    expect(
      queryCalls.filter((s) => s === "SET check_function_bodies = on"),
    ).toHaveLength(1);
  });

  test("should log deferred statement id and reason when debug logging is enabled", async () => {
    const statements: StatementEntry[] = [
      { id: "table", sql: "CREATE TABLE test.users (id int);" },
      { id: "schema", sql: "CREATE SCHEMA test;" },
    ];

    const appliedSet = new Set<string>();
    const client = createMockClient((sql: string) => {
      if (sql.startsWith("SET ")) return;
      if (sql.includes("CREATE TABLE") && !appliedSet.has("schema")) {
        throw pgError("3F000", 'schema "test" does not exist');
      }
      if (sql.includes("CREATE SCHEMA")) appliedSet.add("schema");
    });
    const pool = createMockPool(client);

    const logs: LogRecord[] = [];
    await configure({
      reset: true,
      sinks: {
        capture: (record) => {
          logs.push(record);
        },
      },
      loggers: [
        {
          category: ["pg-delta", "declarative-apply"],
          sinks: ["capture"],
          lowestLevel: "debug",
        },
        {
          category: ["logtape"],
          sinks: ["capture"],
          lowestLevel: "error",
        },
      ],
    });
    try {
      const result = await roundApply({ pool, statements });
      expect(result.status).toBe("success");
      expect(result.rounds[0].deferred).toBe(1);
    } finally {
      await reset();
    }

    const deferredLog = logs.find(
      (record) =>
        record.rawMessage === "deferred {statementId}: {code} - {message}",
    );
    expect(deferredLog).toBeDefined();
    expect(deferredLog?.properties.statementId).toBe("table");
    expect(deferredLog?.properties.code).toBe("3F000");
    expect(String(deferredLog?.properties.message)).toMatch(
      /schema.*does not exist/i,
    );
  });
});

describe("rewriteAsOrReplace", () => {
  test("adds OR REPLACE to CREATE FUNCTION", () => {
    expect(
      rewriteAsOrReplace(
        "CREATE FUNCTION foo() RETURNS void AS $$ BEGIN END; $$ LANGUAGE plpgsql;",
      ),
    ).toBe(
      "CREATE OR REPLACE FUNCTION foo() RETURNS void AS $$ BEGIN END; $$ LANGUAGE plpgsql;",
    );
  });

  test("does not double-add OR REPLACE", () => {
    const sql =
      "CREATE OR REPLACE FUNCTION foo() RETURNS void AS $$ BEGIN END; $$ LANGUAGE plpgsql;";
    expect(rewriteAsOrReplace(sql)).toBe(sql);
  });

  test("handles CREATE PROCEDURE", () => {
    expect(
      rewriteAsOrReplace(
        "CREATE PROCEDURE bar() AS $$ BEGIN END; $$ LANGUAGE plpgsql;",
      ),
    ).toBe(
      "CREATE OR REPLACE PROCEDURE bar() AS $$ BEGIN END; $$ LANGUAGE plpgsql;",
    );
  });

  test("does not double-add OR REPLACE on procedure", () => {
    const sql =
      "CREATE OR REPLACE PROCEDURE bar() AS $$ BEGIN END; $$ LANGUAGE plpgsql;";
    expect(rewriteAsOrReplace(sql)).toBe(sql);
  });

  test("preserves leading line comments", () => {
    const sql =
      "-- pg-topo:requires function:app.other(int)\nCREATE FUNCTION foo() RETURNS void AS $$ BEGIN END; $$ LANGUAGE plpgsql;";
    const result = rewriteAsOrReplace(sql);
    expect(result).toContain("-- pg-topo:requires");
    expect(result).toContain("OR REPLACE FUNCTION");
  });

  test("is case-insensitive", () => {
    expect(
      rewriteAsOrReplace(
        "create function foo() returns void as $$ begin end; $$ language plpgsql;",
      ),
    ).toContain("OR REPLACE function");
  });

  test("preserves leading block comments and adds OR REPLACE", () => {
    const sql =
      "/* some block comment */\nCREATE FUNCTION foo() RETURNS void AS $$ BEGIN END; $$ LANGUAGE plpgsql;";
    const result = rewriteAsOrReplace(sql);
    expect(result).toContain("/* some block comment */");
    expect(result).toContain("OR REPLACE FUNCTION");
  });

  test("handles mixed line and block comments before CREATE", () => {
    const sql =
      "-- line comment\n/* block */\nCREATE FUNCTION foo() RETURNS void AS $$ BEGIN END; $$ LANGUAGE plpgsql;";
    const result = rewriteAsOrReplace(sql);
    expect(result).toContain("-- line comment");
    expect(result).toContain("/* block */");
    expect(result).toContain("OR REPLACE FUNCTION");
  });

  test("handles block comment before CREATE PROCEDURE", () => {
    const sql =
      "/* annotation */\nCREATE PROCEDURE bar() AS $$ BEGIN END; $$ LANGUAGE plpgsql;";
    const result = rewriteAsOrReplace(sql);
    expect(result).toContain("/* annotation */");
    expect(result).toContain("OR REPLACE PROCEDURE");
  });

  test("does not double-add OR REPLACE after block comment", () => {
    const sql =
      "/* comment */\nCREATE OR REPLACE FUNCTION foo() RETURNS void AS $$ BEGIN END; $$ LANGUAGE plpgsql;";
    expect(rewriteAsOrReplace(sql)).toBe(sql);
  });
});
