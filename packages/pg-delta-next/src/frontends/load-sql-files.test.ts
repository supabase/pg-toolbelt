/**
 * Unit tests for the SQL-file transaction-control scanner (review finding 6).
 *
 * The loader wraps each file in an explicit BEGIN/COMMIT for atomic retry. A
 * file containing its OWN transaction-control statement (COMMIT, BEGIN, …)
 * would break that guarantee — committing partial DDL before a later statement
 * fails. `findTransactionControl` rejects such files, but must NOT false-fire
 * on the same keywords appearing in comments, string literals, dollar-quoted
 * function bodies, or PG14+ `BEGIN ATOMIC` bodies.
 *
 * No Docker required (pure string scan).
 */
import { describe, expect, test } from "bun:test";
import { findTransactionControl } from "./load-sql-files.ts";

describe("findTransactionControl — rejects top-level transaction control", () => {
  test("a bare COMMIT between statements is detected", () => {
    const found = findTransactionControl(
      `CREATE TABLE t (id int); COMMIT; CREATE TABLE u (id int);`,
    );
    expect(found.join(" ")).toContain("COMMIT");
  });

  test("BEGIN / ROLLBACK / SAVEPOINT / RELEASE are detected", () => {
    expect(findTransactionControl(`BEGIN;`).join(" ")).toContain("BEGIN");
    expect(findTransactionControl(`ROLLBACK;`).join(" ")).toContain("ROLLBACK");
    expect(findTransactionControl(`SAVEPOINT sp;`).join(" ")).toContain(
      "SAVEPOINT",
    );
    expect(findTransactionControl(`RELEASE SAVEPOINT sp;`).join(" ")).toContain(
      "RELEASE",
    );
    expect(findTransactionControl(`START TRANSACTION;`).join(" ")).toContain(
      "START TRANSACTION",
    );
    expect(
      findTransactionControl(`PREPARE TRANSACTION 'gid';`).join(" "),
    ).toContain("PREPARE TRANSACTION");
  });
});

describe("findTransactionControl — no false positives", () => {
  test("clean DDL is accepted", () => {
    expect(
      findTransactionControl(`CREATE SCHEMA s; CREATE TABLE s.t (id int);`),
    ).toEqual([]);
  });

  test("the keyword inside a single-quoted literal is ignored", () => {
    expect(
      findTransactionControl(
        `CREATE FUNCTION f() RETURNS text LANGUAGE sql AS 'SELECT ''COMMIT''';`,
      ),
    ).toEqual([]);
  });

  test("the keyword inside a line comment is ignored", () => {
    expect(
      findTransactionControl(`-- COMMIT later\nCREATE TABLE t (id int);`),
    ).toEqual([]);
  });

  test("transaction control inside a dollar-quoted body is ignored", () => {
    expect(
      findTransactionControl(
        `CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN COMMIT; END; $$;`,
      ),
    ).toEqual([]);
  });

  test("a PG14+ BEGIN ATOMIC function body is accepted", () => {
    expect(
      findTransactionControl(
        `CREATE FUNCTION f() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1; END;`,
      ),
    ).toEqual([]);
  });
});
