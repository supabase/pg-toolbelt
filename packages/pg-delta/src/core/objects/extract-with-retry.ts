import debug from "debug";

const log = debug("pg-delta:extract");

const DEFAULT_RETRIES = 2;
const DEFAULT_BACKOFF_MS = 50;

export interface ExtractRetryOptions {
  /**
   * Number of retry attempts to make when a `pg_get_*def()` call returns NULL
   * for at least one row. Total attempts is `retries + 1`. Negative values are
   * clamped to 0. When this option is undefined the value is read from the
   * `PGDELTA_EXTRACT_RETRIES` environment variable, falling back to a default
   * of 2 (i.e. up to 3 attempts).
   */
  retries?: number;
  /**
   * Delay between retry attempts in milliseconds; the actual wait is
   * `backoffMs * attemptNumber` (linear). Defaults to 50. Set to 0 in tests.
   */
  backoffMs?: number;
}

export function resolveExtractRetries(option?: number): number {
  if (typeof option === "number" && Number.isFinite(option)) {
    return Math.max(0, Math.floor(option));
  }
  const envVal = process.env.PGDELTA_EXTRACT_RETRIES;
  if (envVal !== undefined && envVal !== "") {
    const n = Number(envVal);
    if (Number.isFinite(n)) return Math.max(0, Math.floor(n));
  }
  return DEFAULT_RETRIES;
}

const sleep = (ms: number) =>
  ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve();

/**
 * Runs `query()` up to `retries + 1` times, retrying as long as at least one
 * row in the result satisfies `hasNullDefinition`. The retry exists because
 * `pg_get_<x>def()` can return NULL transiently when the underlying catalog
 * row is dropped concurrently or the catalog state is in flux; in practice a
 * second attempt either no longer sees the dropped row or succeeds in
 * resolving the definition.
 *
 * Returns the rows from the first attempt with no offenders, or — once
 * retries are exhausted — the rows from the final attempt (still containing
 * offenders). The caller is responsible for the final filter so this helper
 * works for both flat schemas (definition on the row) and nested schemas
 * (definition on a child collection, e.g. table constraints).
 */
export async function extractWithDefinitionRetry<TRow>(params: {
  label: string;
  query: () => Promise<TRow[]>;
  hasNullDefinition: (row: TRow) => boolean;
  options?: ExtractRetryOptions;
}): Promise<TRow[]> {
  const retries = resolveExtractRetries(params.options?.retries);
  const backoffMs = params.options?.backoffMs ?? DEFAULT_BACKOFF_MS;
  const maxAttempts = retries + 1;

  let rows: TRow[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    rows = await params.query();
    const offenders = rows.filter(params.hasNullDefinition).length;
    if (offenders === 0) return rows;
    if (attempt < maxAttempts) {
      log(
        "%s: pg_get_*def() returned NULL for %d row(s) on attempt %d/%d; retrying",
        params.label,
        offenders,
        attempt,
        maxAttempts,
      );
      await sleep(backoffMs * attempt);
    } else {
      log(
        "%s: pg_get_*def() returned NULL for %d row(s) after %d attempt(s); skipping",
        params.label,
        offenders,
        maxAttempts,
      );
    }
  }
  return rows;
}
