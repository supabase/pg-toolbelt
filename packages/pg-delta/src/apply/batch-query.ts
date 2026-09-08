/**
 * Simple-protocol multi-statement batches for apply(). Postgres lexes the
 * entire Query string before any statement runs (protocol §54.2.2.1), then
 * emits CommandComplete per finished statement and skips the rest on error.
 * Semantic failures use the completion count. Parse failures emit none —
 * map error.position through the join offsets we already know.
 */
import { Query } from "pg";

const DEFAULT_BATCH_MAX_STATEMENTS = 500;
const DEFAULT_BATCH_MAX_BYTES = 1024 * 1024;
const JOIN_SEP = "\n\n";

const TX_CONTROL = /^(BEGIN|COMMIT|ROLLBACK)\b/i;

interface BatchBounds {
  maxStatements?: number;
  maxBytes?: number;
}

export interface BatchRange {
  start: number;
  end: number;
}

export interface EncodedBatch {
  text: string;
  ranges: BatchRange[];
}

interface QueryInternals {
  handleCommandComplete(msg: unknown, connection: unknown): void;
}

/** node-pg Query that counts CommandComplete. EmptyQueryResponse is not a
 *  batch slot — `;;` from a trailing semicolon on action.sql must not shift
 *  the failing index. */
class CountingQuery extends Query {
  completed = 0;
  callback?: (error: Error | undefined, result?: unknown) => void;

  handleCommandComplete(msg: unknown, connection: unknown): void {
    this.completed += 1;
    (Query.prototype as unknown as QueryInternals).handleCommandComplete.call(
      this,
      msg,
      connection,
    );
  }
}

function stripTrailingSemicolons(sql: string): string {
  return sql.replace(/;+\s*$/, "");
}

/** Semicolon on its own line so a trailing `--` cannot swallow the separator. */
function terminate(sql: string): string {
  return `${stripTrailingSemicolons(sql).trimEnd()}\n;`;
}

/** Postgres POSITION counts client-encoding characters, not UTF-16 units. */
function pgChars(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) i += 1;
    n += 1;
  }
  return n;
}

export function encodeBatch(statements: readonly string[]): EncodedBatch {
  const ranges: BatchRange[] = [];
  let text = "";
  let chars = 0;
  for (let i = 0; i < statements.length; i++) {
    if (i > 0) {
      text += JOIN_SEP;
      chars += pgChars(JOIN_SEP);
    }
    const start = chars;
    const piece = terminate(statements[i]!);
    text += piece;
    chars += pgChars(piece);
    ranges.push({ start, end: chars });
  }
  return { text, ranges };
}

export function joinStatements(statements: readonly string[]): string {
  return encodeBatch(statements).text;
}

/** Action text that would collide with executor transaction framing. */
export function assertActionSqlBatchable(sql: string): void {
  const trimmed = sql
    .trim()
    .replace(/;+\s*$/, "")
    .trim();
  if (trimmed.length === 0) {
    throw new Error("apply: action SQL must not be empty");
  }
  if (TX_CONTROL.test(trimmed)) {
    throw new Error(
      `apply: action SQL must not be a transaction control statement: ${trimmed}`,
    );
  }
}

function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function terminatedBytes(sql: string): number {
  return utf8Bytes(terminate(sql));
}

export function partitionByBatchBounds<T>(
  items: readonly T[],
  textOf: (item: T) => string,
  bounds: BatchBounds = {},
): T[][] {
  const maxStatements = bounds.maxStatements ?? DEFAULT_BATCH_MAX_STATEMENTS;
  const maxBytes = bounds.maxBytes ?? DEFAULT_BATCH_MAX_BYTES;
  const batches: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const item of items) {
    const piece = terminatedBytes(textOf(item));
    const extra = current.length === 0 ? piece : utf8Bytes(JOIN_SEP) + piece;
    if (
      current.length > 0 &&
      (current.length >= maxStatements || bytes + extra > maxBytes)
    ) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    if (current.length === 0) {
      current = [item];
      bytes = piece;
    } else {
      current.push(item);
      bytes += extra;
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export function completedBeforeError(error: unknown): number {
  const tagged = (error as { completedBeforeError?: unknown })
    .completedBeforeError;
  if (typeof tagged === "number" && Number.isInteger(tagged) && tagged >= 0) {
    return tagged;
  }
  return 0;
}

/** 0-based character index from Postgres POSITION (1-based, protocol field P). */
function errorPosition(error: unknown): number | undefined {
  const raw = (error as { position?: unknown }).position;
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && /^\d+$/.test(raw)
        ? Number(raw)
        : undefined;
  if (n === undefined || !Number.isInteger(n) || n < 1) return undefined;
  return n - 1;
}

function slotAtChar(ranges: readonly BatchRange[], pos0: number): number {
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i]!;
    if (pos0 >= range.start && pos0 < range.end) return i;
  }
  for (let i = 0; i < ranges.length; i++) {
    if (pos0 < ranges[i]!.start) return i;
  }
  return Math.max(0, ranges.length - 1);
}

/**
 * Index of the failing batch slot, or `batchLength` when completions walked
 * off the end (a prior slot emitted more than one CommandComplete).
 */
export function failedBatchIndex(
  batchLength: number,
  error: unknown,
  ranges: readonly BatchRange[],
): number {
  const pos = errorPosition(error);
  if (pos !== undefined && ranges.length > 0) {
    return slotAtChar(ranges, pos);
  }
  const completed = completedBeforeError(error);
  if (completed === 0) return 0;
  if (completed < batchLength) return completed;
  return batchLength;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as PromiseLike<unknown>).then === "function"
  );
}

function tagCompleted(error: unknown, completed: number): void {
  (error as { completedBeforeError?: number }).completedBeforeError ??=
    completed;
}

export async function querySimpleBatch(
  client: { query: (query: CountingQuery) => unknown },
  statements: readonly string[],
): Promise<{ completed: number }> {
  const q = new CountingQuery(joinStatements(statements));
  let settled = false;
  const viaCallback = new Promise<{ completed: number }>((resolve, reject) => {
    q.callback = (error: Error | undefined) => {
      if (settled) return;
      settled = true;
      if (error) {
        tagCompleted(error, q.completed);
        reject(error);
      } else {
        resolve({ completed: q.completed });
      }
    };
  });
  try {
    const maybe = client.query(q);
    if (maybe !== q && isThenable(maybe)) {
      await maybe;
      return { completed: q.completed };
    }
    return await viaCallback;
  } catch (error) {
    tagCompleted(error, q.completed);
    throw error;
  }
}
