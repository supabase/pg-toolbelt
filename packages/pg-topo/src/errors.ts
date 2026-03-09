import { Data } from "effect";

/**
 * Fatal failure loading the parser WASM module. Distinct from SQL-level parse
 * errors so callers can differentiate infrastructure failures from bad input.
 */
export class WasmLoadError extends Data.TaggedError("WasmLoadError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Fatal parser failure — SQL syntax is completely invalid or the parser
 * encountered an unexpected error while processing input.
 * Non-fatal parse issues remain as diagnostics.
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
