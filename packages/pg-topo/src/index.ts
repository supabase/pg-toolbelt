// ============================================================================
// Effect-native exports (for Effect consumers)
// ============================================================================
// ============================================================================
// Promise-based exports (backward compatible — unchanged signatures)
// ============================================================================
export { analyzeAndSort, analyzeAndSortEffect } from "./analyze-and-sort.ts";
export {
  DiscoveryError,
  ParseError,
  ValidationError,
  WasmLoadError,
} from "./errors.ts";
export {
  analyzeAndSortFromFiles,
  analyzeAndSortFromFilesEffect,
} from "./from-files.ts";
// ============================================================================
// Type re-exports (unchanged)
// ============================================================================
export type {
  AnalyzeOptions,
  AnalyzeResult,
  AnnotationHints,
  Diagnostic,
  DiagnosticCode,
  GraphEdge,
  GraphEdgeReason,
  GraphReport,
  ObjectKind,
  ObjectRef,
  PhaseTag,
  StatementId,
  StatementNode,
} from "./model/types.ts";
export { type ParserApi, ParserService } from "./services/parser.ts";
export { ParserServiceLive } from "./services/parser-live.ts";
export { validateSqlSyntax, validateSqlSyntaxEffect } from "./validate-sql.ts";
