import { Data } from "effect";

/**
 * Fatal parser failure — the parser WASM module fails to load, or SQL syntax
 * is completely invalid. Non-fatal parse issues remain as diagnostics.
 */
export class ParseError extends Data.TaggedError("ParseError")<{
  readonly message: string;
  readonly filePath?: string;
  readonly cause?: unknown;
}> {}

/**
 * Replaces the missingRoots tracking in discover.ts.
 * Used when no SQL files can be found at all.
 */
export class DiscoveryError extends Data.TaggedError("DiscoveryError")<{
  readonly message: string;
  readonly missingRoots: readonly string[];
}> {}

/**
 * Replaces the throw in validate-sql.ts (parseSql throws on syntax errors).
 */
export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
