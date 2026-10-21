/**
 * Applies a migration file the way the Supabase CLI's TS executor does
 * (apps/cli/src/command-internal/migration-apply.ts, cli@24347954f), with the
 * security check appended per RFC §6 / D22. Shared by the integration tests and
 * the dogfood harness; not part of the package API.
 *
 * Mirrored CLI behavior:
 * - `RESET ALL`, then the history-table DDL (migration-history.ts).
 * - Transactional files: every statement plus the history insert in ONE
 *   extended-protocol pipeline closed by a single Sync (`PgBatchQuery`), i.e. one
 *   implicit transaction. The check statements go between the file and the insert.
 * - Files with authored transaction control, or the `-- pg-delta:
 *   transaction=false` directive: statements one by one, history insert last.
 * - Pipeline-incompatible statements (CONCURRENTLY, VACUUM, ...): the open batch
 *   is flushed, the statement runs alone, the rest batches with the insert.
 * The last two are "split" files: no in-transaction check (D22).
 */
import type { Client, Connection, Submittable } from "pg";
import {
  type CheckError,
  type Finding,
  type ResolvedPolicy,
  buildAfterCommitRead,
  buildCheckStatements,
  parseCheckError,
  parseFindings,
} from "../src/index.ts";

export interface MigrationFile {
  readonly version: string;
  readonly name: string;
  readonly statements: readonly string[];
  /** `none` when the file starts with the pg-delta no-transaction directive. */
  readonly transactionMode?: "transactional" | "none";
}

export interface ApplyOptions {
  readonly exposedSchemas?: readonly string[];
  readonly timeoutMs?: number;
  /** Baseline run: no check statements at all. */
  readonly skipChecks?: boolean;
}

export type ApplyResult =
  | {
      readonly outcome: "applied";
      readonly split: boolean;
      readonly ms: number;
    }
  | {
      readonly outcome: "blocked" | "timed_out";
      readonly check: CheckError;
      readonly ms: number;
    }
  | {
      readonly outcome: "apply_error";
      readonly error: Error & { code?: string };
      readonly split: boolean;
      readonly ms: number;
    };

// migration-history.ts
const HISTORY_DDL = [
  "BEGIN",
  "SET LOCAL lock_timeout = '4s'",
  "CREATE SCHEMA IF NOT EXISTS supabase_migrations",
  "CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text NOT NULL PRIMARY KEY)",
  "ALTER TABLE supabase_migrations.schema_migrations ADD COLUMN IF NOT EXISTS statements text[]",
  "ALTER TABLE supabase_migrations.schema_migrations ADD COLUMN IF NOT EXISTS name text",
  "COMMIT",
];
const INSERT_MIGRATION_VERSION =
  "INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES($1, $2, $3)";

// migration-apply.ts, statement classifiers (matched after stripping leading comments).
const PIPELINE_INCOMPATIBLE = [
  /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY(?:\s|$)/u,
  /^DROP\s+INDEX\s+CONCURRENTLY(?:\s|$)/u,
  /^REINDEX(?:\s|\().*\sCONCURRENTLY(?:\s|$)/u,
  /^VACUUM(?:\s|\(|$)/u,
  /^ALTER\s+SYSTEM(?:\s|$)/u,
  /^CLUSTER(?:\s|$)/u,
];
const TRANSACTION_CONTROL =
  /^(?:BEGIN|START\s+TRANSACTION|COMMIT|END|ABORT|PREPARE\s+TRANSACTION)(?:\s|$)/u;

function stripLeadingComments(sql: string): string {
  let text = sql.replace(/^[\s﻿]+/u, "");
  for (;;) {
    if (text.startsWith("--")) {
      const nl = text.indexOf("\n");
      if (nl < 0) return "";
      text = text.slice(nl + 1).trimStart();
    } else if (text.startsWith("/*")) {
      const end = text.indexOf("*/");
      if (end < 0) return text;
      text = text.slice(end + 2).trimStart();
    } else {
      return text.trim();
    }
  }
}

export const isPipelineIncompatible = (sql: string) => {
  const upper = stripLeadingComments(sql).toUpperCase();
  return PIPELINE_INCOMPATIBLE.some((re) => re.test(upper));
};

export const hasTransactionControl = (sql: string) => {
  const upper = stripLeadingComments(sql).toUpperCase();
  const words = upper.split(/\s+/u);
  if (words[0] === "ROLLBACK") {
    const toIndex = words[1] === "WORK" || words[1] === "TRANSACTION" ? 2 : 1;
    return words[toIndex] !== "TO";
  }
  return TRANSACTION_CONTROL.test(upper);
};

/** Whether the CLI would split this file, so the in-transaction check is skipped (D22). */
export const isSplitFile = (file: MigrationFile) =>
  file.transactionMode === "none" ||
  file.statements.some(hasTransactionControl) ||
  file.statements.some(isPipelineIncompatible);

interface BatchOp {
  readonly sql: string;
  readonly params?: readonly (string | readonly string[])[];
}

const encodeTextArray = (values: readonly string[]) =>
  `{${values.map((v) => `"${v.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`).join(",")}}`;

/** Port of the CLI's `PgBatchQuery`: Parse/Bind/Describe/Execute per op, one Sync. */
class BatchQuery implements Submittable {
  completed = 0;
  private done = false;
  constructor(
    private readonly ops: readonly BatchOp[],
    private readonly callback: (
      error: (Error & { statementIndex?: number }) | undefined,
    ) => void,
  ) {}
  submit(connection: Connection): void {
    for (const { sql, params } of this.ops) {
      const values = (params ?? []).map((p) =>
        typeof p === "string" ? p : encodeTextArray(p),
      );
      connection.parse({ name: "", text: sql, types: [] }, true);
      connection.bind({ portal: "", statement: "", values }, true);
      connection.describe({ type: "P", name: "" }, true);
      connection.execute({ portal: "" }, true);
    }
    connection.sync();
  }
  handleRowDescription() {}
  handleDataRow() {}
  handlePortalSuspended() {}
  handleCommandComplete() {
    this.completed += 1;
  }
  handleEmptyQuery() {
    this.completed += 1;
  }
  handleError(error: Error) {
    if (this.done) return;
    this.done = true;
    this.callback(Object.assign(error, { statementIndex: this.completed }));
  }
  handleReadyForQuery() {
    if (this.done) return;
    this.done = true;
    this.callback(undefined);
  }
}

export function runBatch(
  client: Client,
  ops: readonly BatchOp[],
): Promise<void> {
  if (ops.length === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    void client.query(
      new BatchQuery(ops, (error) =>
        error === undefined ? resolve() : reject(error),
      ),
    );
  });
}

export async function ensureHistoryTable(client: Client): Promise<void> {
  try {
    for (const sql of HISTORY_DDL) await client.query(sql);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

export async function applyMigrationLikeCli(
  client: Client,
  file: MigrationFile,
  policy: ResolvedPolicy,
  options: ApplyOptions = {},
): Promise<ApplyResult> {
  await client.query("RESET ALL");
  await ensureHistoryTable(client);
  const insert: BatchOp = {
    sql: INSERT_MIGRATION_VERSION,
    params: [file.version, file.name, [...file.statements]],
  };
  const split = isSplitFile(file);
  const start = performance.now();
  const ms = () => Math.round(performance.now() - start);
  try {
    if (
      file.transactionMode === "none" ||
      file.statements.some(hasTransactionControl)
    ) {
      try {
        for (const sql of file.statements) await client.query(sql);
        await client.query(INSERT_MIGRATION_VERSION, [
          file.version,
          file.name,
          file.statements,
        ]);
      } catch (error) {
        await client
          .query(file.transactionMode === "none" ? "RESET ALL" : "ROLLBACK")
          .catch(() => {});
        throw error;
      }
    } else if (split) {
      let pending: BatchOp[] = [];
      for (const sql of file.statements) {
        if (isPipelineIncompatible(sql)) {
          await runBatch(client, pending);
          pending = [];
          await client.query(sql);
        } else {
          pending.push({ sql });
        }
      }
      await runBatch(client, [...pending, insert]);
    } else {
      const check = options.skipChecks
        ? []
        : buildCheckStatements(policy, {
            ...(options.exposedSchemas
              ? { exposedSchemas: options.exposedSchemas }
              : {}),
            ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
          });
      await runBatch(client, [
        ...file.statements.map((sql) => ({ sql })),
        ...check.map((sql) => ({ sql })),
        insert,
      ]);
    }
    return { outcome: "applied", split, ms: ms() };
  } catch (error) {
    const check = parseCheckError(error);
    if (check !== null) {
      return {
        outcome: check.kind === "blocked" ? "blocked" : "timed_out",
        check,
        ms: ms(),
      };
    }
    return {
      outcome: "apply_error",
      error: error as Error & { code?: string },
      split,
      ms: ms(),
    };
  }
}

/** The after-commit read (RFC §4) on the same connection. */
export async function readFindings(
  client: Client,
  policy: ResolvedPolicy,
  exposedSchemas?: readonly string[],
): Promise<Finding[]> {
  const read = buildAfterCommitRead(
    policy,
    exposedSchemas ? { exposedSchemas } : {},
  );
  let rows: unknown[] = [];
  try {
    for (const [index, sql] of read.statements.entries()) {
      const result = await client.query(sql);
      if (index === read.resultIndex) rows = result.rows;
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
  return parseFindings(rows, policy);
}
