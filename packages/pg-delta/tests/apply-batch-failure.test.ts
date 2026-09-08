/**
 * Mid-batch apply failures name the failing plan action from CommandComplete
 * count (semantic errors) or error.position through join offsets (parse
 * errors). COMMIT stays its own round trip so inDoubt semantics match
 * today's executor.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { apply, type ApplyEvent } from "../src/apply/apply.ts";
import {
  completedBeforeError,
  querySimpleBatch,
} from "../src/apply/batch-query.ts";
import type { Action } from "../src/plan/plan.ts";
import { createTestDb, type TestDb } from "./containers.ts";
import {
  planFromActions,
  txnAction,
  withApplyQueries,
} from "./apply-test-helpers.ts";

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

describe("apply() batched failure attribution", () => {
  test("a mid-segment failure names action k and rolls the segment back", async () => {
    const db = await createTestDb("apply_batch_fail");
    dbs.push(db);

    const failSql = "SELECT 1 FROM batch_fail.does_not_exist";
    const priorSql = "CREATE TABLE batch_fail.t3 (id int)";
    const actions: Action[] = [
      txnAction("CREATE SCHEMA batch_fail"),
      txnAction("CREATE TABLE batch_fail.t0 (id int)", {
        newSegmentBefore: true,
      }),
      txnAction("CREATE TABLE batch_fail.t1 (id int)"),
      txnAction("CREATE TABLE batch_fail.t2 (id int)"),
      txnAction(priorSql),
      txnAction(failSql),
      txnAction("CREATE TABLE batch_fail.t5 (id int)"),
      txnAction("CREATE TABLE batch_fail.t6 (id int)"),
      txnAction("CREATE TABLE batch_fail.t7 (id int)"),
      txnAction("CREATE TABLE batch_fail.t8 (id int)"),
      txnAction("CREATE TABLE batch_fail.t9 (id int)"),
    ];
    const failIndex = actions.findIndex((action) => action.sql === failSql);
    expect(failIndex).toBe(5);

    const { result, queries } = await withApplyQueries(db.pool, () =>
      apply(planFromActions(actions), db.pool, {
        fingerprintGate: false,
        lockTableReserveConnections: 1,
        batchTransactional: true,
      }),
    );

    expect(result.status).toBe("failed");
    expect(result.appliedActions).toBe(1);
    expect(result.error).toMatchObject({
      actionIndex: failIndex,
      statementKind: "action",
      sql: failSql,
    });
    expect(result.error?.message).toMatch(/does not exist/i);
    expect(result.actionStatuses).toEqual([
      "applied",
      ...Array.from({ length: 10 }, () => "unapplied" as const),
    ]);
    // the failing statement rode in the same simple-protocol query as
    // earlier actions in the segment — attribution is not "replay until
    // it breaks".
    expect(
      queries.some((sql) => sql.includes(priorSql) && sql.includes(failSql)),
    ).toBe(true);

    const leftover = await db.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'batch_fail' AND c.relkind = 'r'`,
    );
    expect(leftover.rows[0]?.n).toBe(0);
    const schemas = await db.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n
       FROM pg_catalog.pg_namespace
       WHERE nspname = 'batch_fail'`,
    );
    expect(schemas.rows[0]?.n).toBe(1);
  }, 120_000);

  test("EmptyQueryResponse does not consume a batch slot", async () => {
    const db = await createTestDb("apply_batch_empty");
    dbs.push(db);
    const client = await db.pool.connect();
    try {
      await querySimpleBatch(client, [
        "SELECT 1",
        "   ",
        "SELECT 1 FROM apply_batch_empty_missing",
      ]);
      throw new Error("expected the missing-relation statement to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toMatch(/expected the missing/);
      expect(completedBeforeError(error)).toBe(1);
    } finally {
      client.release();
    }
  }, 120_000);

  test("a trailing semicolon on a prior action does not shift attribution", async () => {
    const db = await createTestDb("apply_batch_semi");
    dbs.push(db);

    const priorSql = "CREATE TABLE batch_semi.t (id int);";
    const failSql = "SELECT 1 FROM batch_semi.does_not_exist";
    const actions: Action[] = [
      txnAction("CREATE SCHEMA batch_semi"),
      txnAction(priorSql, { newSegmentBefore: true }),
      txnAction(failSql),
    ];

    const result = await apply(planFromActions(actions), db.pool, {
      fingerprintGate: false,
      lockTableReserveConnections: 1,
      batchTransactional: true,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toMatchObject({
      actionIndex: 2,
      statementKind: "action",
      sql: failSql,
    });
    expect(result.actionStatuses).toEqual([
      "applied",
      "unapplied",
      "unapplied",
    ]);
  }, 120_000);

  test("a trailing line comment does not swallow the next action", async () => {
    const db = await createTestDb("apply_batch_dash");
    dbs.push(db);

    const failSql = "SELECT 1 FROM batch_dash.does_not_exist";
    const actions: Action[] = [
      txnAction("CREATE SCHEMA batch_dash"),
      txnAction("CREATE TABLE batch_dash.t (id int) -- leftover", {
        newSegmentBefore: true,
      }),
      txnAction(failSql),
    ];

    const result = await apply(planFromActions(actions), db.pool, {
      fingerprintGate: false,
      lockTableReserveConnections: 1,
      batchTransactional: true,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toMatchObject({
      actionIndex: 2,
      statementKind: "action",
      sql: failSql,
    });
  }, 120_000);

  test("a syntax error in a later action is not reported as BEGIN", async () => {
    const db = await createTestDb("apply_batch_syn");
    dbs.push(db);

    const failSql = "SELCT 1";
    const actions: Action[] = [
      txnAction("CREATE SCHEMA batch_syn"),
      txnAction("CREATE TABLE batch_syn.t (id int)", {
        newSegmentBefore: true,
      }),
      txnAction(failSql),
      txnAction("CREATE TABLE batch_syn.u (id int)"),
    ];

    const result = await apply(planFromActions(actions), db.pool, {
      fingerprintGate: false,
      lockTableReserveConnections: 1,
      batchTransactional: true,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toMatchObject({
      actionIndex: 2,
      statementKind: "action",
      sql: failSql,
    });
    expect(result.error?.message).toMatch(/syntax error/i);
    expect(result.actionStatuses).toEqual([
      "applied",
      "unapplied",
      "unapplied",
      "unapplied",
    ]);
  }, 120_000);

  test("extra CommandCompletes from a multi-statement action do not blame BEGIN", async () => {
    const db = await createTestDb("apply_batch_acl");
    dbs.push(db);

    const grantSql =
      "REVOKE ALL ON SCHEMA batch_acl FROM PUBLIC;\nGRANT USAGE ON SCHEMA batch_acl TO PUBLIC";
    const failSql = "SELECT 1 FROM batch_acl.does_not_exist";
    const actions: Action[] = [
      txnAction("CREATE SCHEMA batch_acl"),
      txnAction(grantSql, { newSegmentBefore: true }),
      txnAction(failSql),
    ];

    const result = await apply(planFromActions(actions), db.pool, {
      fingerprintGate: false,
      lockTableReserveConnections: 1,
      batchTransactional: true,
    });

    expect(result.status).toBe("failed");
    expect(result.error).toMatchObject({
      actionIndex: 2,
      statementKind: "action",
      sql: failSql,
    });
    expect(result.error?.statementKind).not.toBe("control");
  }, 120_000);

  test("query_timeout on the client cannot hang a failing batch", async () => {
    const db = await createTestDb("apply_batch_qto");
    dbs.push(db);
    const client = await db.pool.connect();
    (
      client as unknown as {
        connectionParameters: { query_timeout?: number };
      }
    ).connectionParameters.query_timeout = 80;
    const started = performance.now();
    try {
      await querySimpleBatch(client, ["SELECT pg_sleep(5)"]);
      throw new Error("expected query_timeout to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/timeout/i);
      expect(performance.now() - started).toBeLessThan(4_000);
    } finally {
      client.release();
    }
  }, 15_000);

  test("COMMIT failure (deferred constraint) is an in-doubt control error", async () => {
    const db = await createTestDb("apply_batch_commit");
    dbs.push(db);

    const events: ApplyEvent[] = [];
    const actions: Action[] = [
      txnAction("CREATE SCHEMA batch_commit"),
      txnAction(
        `CREATE TABLE batch_commit.t (
          id int PRIMARY KEY,
          parent int,
          CONSTRAINT t_parent_fk FOREIGN KEY (parent)
            REFERENCES batch_commit.t (id)
            DEFERRABLE INITIALLY DEFERRED
        )`,
        { newSegmentBefore: true },
      ),
      txnAction("INSERT INTO batch_commit.t (id, parent) VALUES (1, 999)"),
    ];

    const { result, queries } = await withApplyQueries(db.pool, () =>
      apply(planFromActions(actions), db.pool, {
        fingerprintGate: false,
        lockTableReserveConnections: 1,
        batchTransactional: true,
        onEvent: (event) => events.push(event),
      }),
    );

    expect(result.status).toBe("failed");
    expect(result.error).toMatchObject({
      actionIndex: 1,
      statementKind: "control",
      sql: "COMMIT",
    });
    expect(result.error?.message).toMatch(/t_parent_fk|foreign key/i);
    expect(result.actionStatuses).toEqual(["applied", "inDoubt", "inDoubt"]);
    expect(queries.some((sql) => sql.trim() === "COMMIT")).toBe(true);
    expect(
      queries.some((sql) => sql.includes("BEGIN") && sql.includes("COMMIT")),
    ).toBe(false);
    expect(
      events.some(
        (event) => event.kind === "control" && event.sql === "COMMIT",
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) => event.kind === "segmentEnd" && event.outcome === "inDoubt",
      ),
    ).toBe(true);

    const tables = await db.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n
       FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'batch_commit' AND c.relkind = 'r'`,
    );
    expect(tables.rows[0]?.n).toBe(0);
  }, 120_000);
});
