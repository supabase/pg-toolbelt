/**
 * Lock-table preflight and opt-in baseline commit boundaries.
 *
 * A single transactional apply segment holds every created relation lock
 * until COMMIT. The lock table is sized from
 * `max_locks_per_transaction × (max_connections + max_prepared_transactions)`
 * (PostgreSQL "Lock Management"); one baseline can exhaust it. We estimate
 * per existing segment, reserve slots for backends that are already busy
 * plus a new-connection margin, and fail before the first DDL. Chunking is
 * opt-in (`baselineCommitEvery`) and only valid when nothing else reads
 * the target during apply.
 */
import { LOCK_TABLE_BUDGET_EXCEEDED } from "../core/diagnostic.ts";
import {
  LOCK_HOLDING_RELATION_KINDS,
  markBaselineCommitBoundaries,
} from "../plan/baseline-commit.ts";

export { markBaselineCommitBoundaries };

/** Heap relations that also create a toast table + toast index. */
const TOAST_KINDS = new Set(["table", "materializedView"]);

export interface LockTableSettings {
  maxLocksPerTransaction: number;
  maxConnections: number;
  maxPreparedTransactions: number;
  /** Other client backends / autovacuum workers that are not idle. */
  busyOthers: number;
  /** Other client backends, idle included — used only to clamp the reserve. */
  otherBackends: number;
  /** In-flight prepared transactions (2PC), each holding locks until resolved. */
  preparedXacts: number;
}

export interface LockTableBudget {
  capacity: number;
  available: number;
  busyOthers: number;
  reserveNew: number;
  maxLocksPerTransaction: number;
  maxConnections: number;
  maxPreparedTransactions: number;
}

export interface LockEstimateAction {
  verb: "create" | "alter" | "drop";
  produces: ReadonlyArray<{ kind: string }>;
  destroys: ReadonlyArray<{ kind: string }>;
  consumes?: ReadonlyArray<{ kind: string }>;
}

interface Queryable {
  query(sql: string): Promise<{ rows: unknown[] }>;
}

export class LockTableBudgetExceededError extends Error {
  readonly code = LOCK_TABLE_BUDGET_EXCEEDED;
  readonly estimate: number;
  readonly budget: LockTableBudget;
  readonly segmentIndex: number;

  constructor(opts: {
    segmentIndex: number;
    estimate: number;
    budget: LockTableBudget;
  }) {
    super(formatLockTableBudgetMessage(opts));
    this.name = "LockTableBudgetExceededError";
    this.segmentIndex = opts.segmentIndex;
    this.estimate = opts.estimate;
    this.budget = opts.budget;
  }
}

/** Floor of 3, otherwise 10% of `max_connections`. */
export function defaultLockTableReserveConnections(
  maxConnections: number,
): number {
  return Math.max(3, Math.ceil(0.1 * maxConnections));
}

export function computeLockTableBudget(
  settings: LockTableSettings,
  reserveConnections?: number,
): LockTableBudget {
  const capacity =
    settings.maxLocksPerTransaction *
    (settings.maxConnections + settings.maxPreparedTransactions);
  if (
    reserveConnections !== undefined &&
    !Number.isFinite(reserveConnections)
  ) {
    throw new Error(
      `lockTableReserveConnections must be a finite number, got ${String(reserveConnections)}`,
    );
  }
  const requested =
    reserveConnections ??
    defaultLockTableReserveConnections(settings.maxConnections);
  const remainingBackendSlots = Math.max(
    0,
    settings.maxConnections - settings.otherBackends - 1,
  );
  const reserveNew = Math.min(Math.max(0, requested), remainingBackendSlots);
  const available =
    capacity -
    settings.maxLocksPerTransaction *
      (settings.busyOthers + reserveNew + settings.preparedXacts);
  return {
    capacity,
    available,
    busyOthers: settings.busyOthers,
    reserveNew,
    maxLocksPerTransaction: settings.maxLocksPerTransaction,
    maxConnections: settings.maxConnections,
    maxPreparedTransactions: settings.maxPreparedTransactions,
  };
}

function relationLockSlots(kind: string): number {
  if (!LOCK_HOLDING_RELATION_KINDS.has(kind)) return 0;
  return TOAST_KINDS.has(kind) ? 3 : 1;
}

export function estimateActionLocks(action: LockEstimateAction): number {
  let n = 1;
  for (const id of action.produces) n += relationLockSlots(id.kind);
  for (const id of action.destroys) n += relationLockSlots(id.kind);
  // Existing subjects (ALTER / CREATE INDEX on a live table). Toast already
  // exists; count the relation once.
  for (const id of action.consumes ?? []) {
    if (LOCK_HOLDING_RELATION_KINDS.has(id.kind)) n += 1;
  }
  return n;
}

export function estimateSegmentLocks(
  actions: readonly LockEstimateAction[],
): number {
  let n = 0;
  for (const action of actions) n += estimateActionLocks(action);
  return n;
}

export const LOCK_TABLE_PROBE_SQL = `
  SELECT
    current_setting('max_locks_per_transaction')::int AS max_locks_per_transaction,
    current_setting('max_connections')::int AS max_connections,
    current_setting('max_prepared_transactions')::int AS max_prepared_transactions,
    (
      SELECT count(*)::int FROM pg_catalog.pg_stat_activity
      WHERE pid <> pg_backend_pid()
        AND backend_type IN ('client backend', 'autovacuum worker')
        AND state IS DISTINCT FROM 'idle'
    ) AS busy_others,
    (
      SELECT count(*)::int FROM pg_catalog.pg_stat_activity
      WHERE pid <> pg_backend_pid()
        AND backend_type = 'client backend'
    ) AS other_backends,
    (SELECT count(*)::int FROM pg_catalog.pg_prepared_xacts) AS prepared_xacts
`;

function intField(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`apply: lock-table probe: missing ${key}`);
  }
  return n;
}

export async function probeLockTableSettings(
  client: Queryable,
): Promise<LockTableSettings> {
  const res = await client.query(LOCK_TABLE_PROBE_SQL);
  const row = res.rows[0];
  if (row === undefined || typeof row !== "object" || row === null) {
    throw new Error("apply: lock-table probe returned no row");
  }
  const rec = row as Record<string, unknown>;
  return {
    maxLocksPerTransaction: intField(rec, "max_locks_per_transaction"),
    maxConnections: intField(rec, "max_connections"),
    maxPreparedTransactions: intField(rec, "max_prepared_transactions"),
    busyOthers: intField(rec, "busy_others"),
    otherBackends: intField(rec, "other_backends"),
    preparedXacts: intField(rec, "prepared_xacts"),
  };
}

export function assertSegmentsFitLockTable(
  segments: ReadonlyArray<{ start: number; end: number }>,
  actions: readonly LockEstimateAction[],
  budget: LockTableBudget,
): void {
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    const estimate = estimateSegmentLocks(
      actions.slice(segment.start, segment.end),
    );
    if (estimate > budget.available) {
      throw new LockTableBudgetExceededError({
        segmentIndex: i,
        estimate,
        budget,
      });
    }
  }
}

function formatLockTableBudgetMessage(opts: {
  segmentIndex: number;
  estimate: number;
  budget: LockTableBudget;
}): string {
  const { budget } = opts;
  return (
    `apply: ${LOCK_TABLE_BUDGET_EXCEEDED} — segment ${String(opts.segmentIndex)} ` +
    `estimate ${String(opts.estimate)} locks exceeds available ${String(budget.available)} ` +
    `(capacity ${String(budget.capacity)} = ${String(budget.maxLocksPerTransaction)} × ` +
    `(${String(budget.maxConnections)} + ${String(budget.maxPreparedTransactions)}); ` +
    `${String(budget.busyOthers)} busy backends; reserved ${String(budget.reserveNew)} ` +
    `connection(s) × ${String(budget.maxLocksPerTransaction)}). ` +
    `Set plan/apply option baselineCommitEvery so each segment fits, or raise ` +
    `max_locks_per_transaction. baselineCommitEvery counts created relations ` +
    `(table/index/sequence/view/type), not lock slots.`
  );
}
