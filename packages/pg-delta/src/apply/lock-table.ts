/**
 * Lock-table budget probe. Capacity is
 * `max_locks_per_transaction × (max_connections + max_prepared_transactions)`
 * (PostgreSQL "Lock Management"). `available` subtracts busy backends,
 * a new-connection reserve, and in-flight prepared transactions.
 *
 * Call `estimateLockTableBudget` on the apply target, then
 * `splitPlan({ maxLocks: budget.available })` if you want extra COMMITs.
 * Apply does not probe or refuse.
 */

interface Queryable {
  query(sql: string): Promise<{ rows: unknown[] }>;
}

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

const LOCK_TABLE_PROBE_SQL = `
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
    throw new Error(`lock-table probe: missing ${key}`);
  }
  return n;
}

export async function probeLockTableSettings(
  client: Queryable,
): Promise<LockTableSettings> {
  const res = await client.query(LOCK_TABLE_PROBE_SQL);
  const row = res.rows[0];
  if (row === undefined || typeof row !== "object" || row === null) {
    throw new Error("lock-table probe returned no row");
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

/** Probe the apply target and return its remaining lock-slot budget. */
export async function estimateLockTableBudget(
  target: Queryable,
  reserveConnections?: number,
): Promise<LockTableBudget> {
  return computeLockTableBudget(
    await probeLockTableSettings(target),
    reserveConnections,
  );
}
