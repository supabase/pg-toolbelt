import { Data } from "effect";

// ---------------------------------------------------------------------------
// Connection errors
// ---------------------------------------------------------------------------

/**
 * General connection failure — wraps errors from pg pool.connect().
 */
export class ConnectionError extends Data.TaggedError("ConnectionError")<{
  readonly message: string;
  readonly label: "source" | "target";
  readonly cause?: unknown;
}> {}

/**
 * Connection attempt timed out.
 */
export class ConnectionTimeoutError extends Data.TaggedError(
  "ConnectionTimeoutError",
)<{
  readonly message: string;
  readonly label: "source" | "target";
  readonly timeoutMs: number;
}> {}

// ---------------------------------------------------------------------------
// Catalog errors
// ---------------------------------------------------------------------------

/**
 * Catalog extraction query failed — wraps errors from pool.query in extractors.
 */
export class CatalogExtractionError extends Data.TaggedError(
  "CatalogExtractionError",
)<{
  readonly message: string;
  readonly extractor?: string;
  readonly cause?: unknown;
}> {}

// ---------------------------------------------------------------------------
// Plan errors
// ---------------------------------------------------------------------------

/**
 * Plan contains no SQL statements to execute.
 */
export class InvalidPlanError extends Data.TaggedError("InvalidPlanError")<{
  readonly message: string;
}> {}

/**
 * Fingerprint of the current database does not match the plan's source fingerprint.
 */
export class FingerprintMismatchError extends Data.TaggedError(
  "FingerprintMismatchError",
)<{
  readonly current: string;
  readonly expected: string;
}> {}

/**
 * SQL execution failed during plan apply.
 */
export class PlanApplyError extends Data.TaggedError("PlanApplyError")<{
  readonly cause: unknown;
  readonly script: string;
}> {}

/**
 * Plan target fingerprint already matches — no changes needed.
 */
export class AlreadyAppliedError extends Data.TaggedError(
  "AlreadyAppliedError",
)<{}> {}

// ---------------------------------------------------------------------------
// Declarative apply errors
// ---------------------------------------------------------------------------

/**
 * General failure during declarative schema application.
 */
export class DeclarativeApplyError extends Data.TaggedError(
  "DeclarativeApplyError",
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Declarative apply cannot make progress — statements are stuck.
 */
export class StuckError extends Data.TaggedError("StuckError")<{
  readonly message: string;
  readonly stuckStatements: readonly string[];
}> {}

// ---------------------------------------------------------------------------
// SSL/config errors
// ---------------------------------------------------------------------------

/**
 * SSL configuration parsing failed.
 */
export class SslConfigError extends Data.TaggedError("SslConfigError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ---------------------------------------------------------------------------
// File I/O errors
// ---------------------------------------------------------------------------

/**
 * File discovery failure — path does not exist, is not a .sql file, etc.
 */
export class FileDiscoveryError extends Data.TaggedError("FileDiscoveryError")<{
  readonly message: string;
  readonly path: string;
}> {}

// ---------------------------------------------------------------------------
// Plan I/O errors
// ---------------------------------------------------------------------------

/**
 * JSON deserialization or schema validation of a plan file failed.
 */
export class PlanDeserializationError extends Data.TaggedError(
  "PlanDeserializationError",
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
