import { Data, type PlatformError } from "effect";

// ---------------------------------------------------------------------------
// Connection errors (infrastructure-level, no domain-specific fields)
// ---------------------------------------------------------------------------

/**
 * General connection failure — wraps errors from pg pool.connect().
 */
export class ConnectionError extends Data.TaggedError("ConnectionError")<{
  readonly message: string;
  readonly label: "source" | "target";
  readonly cause?: ConnectionTimeoutError | Error;
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
// SSL/config errors
// ---------------------------------------------------------------------------

/**
 * SSL configuration parsing failed.
 */
export class SslConfigError extends Data.TaggedError("SslConfigError")<{
  readonly message: string;
  readonly cause?: PlatformError.PlatformError | SslConfigError;
}> {}
