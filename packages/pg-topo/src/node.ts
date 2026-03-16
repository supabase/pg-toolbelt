import { Layer, ManagedRuntime } from "effect";
import { makeDefaultNodeFileSystemRuntimeLayer } from "./adapters/node-filesystem.ts";
import {
  analyzeAndSort as analyzeAndSortEffect,
  analyzeAndSortFromFiles as analyzeAndSortFromFilesEffect,
  validateSqlSyntax as validateSqlSyntaxEffect,
} from "./effect.ts";
export {
  DiscoveryError,
  ParseError,
  ValidationError,
  WasmLoadError,
} from "./errors.ts";
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
import { ParserServiceLive } from "./services/parser-live.ts";

const parserRuntime = ManagedRuntime.make(ParserServiceLive);

const makeFromFilesRuntime = () =>
  ManagedRuntime.make(
    Layer.mergeAll(ParserServiceLive, makeDefaultNodeFileSystemRuntimeLayer()),
  );

export const analyzeAndSort = (
  sql: Parameters<typeof analyzeAndSortEffect>[0],
  options?: Parameters<typeof analyzeAndSortEffect>[1],
) => parserRuntime.runPromise(analyzeAndSortEffect(sql, options));

export const analyzeAndSortFromFiles = (
  roots: Parameters<typeof analyzeAndSortFromFilesEffect>[0],
  options?: Parameters<typeof analyzeAndSortFromFilesEffect>[1],
) =>
  makeFromFilesRuntime().runPromise(
    analyzeAndSortFromFilesEffect(roots, options),
  );

export const validateSqlSyntax = (
  sql: Parameters<typeof validateSqlSyntaxEffect>[0],
) => parserRuntime.runPromise(validateSqlSyntaxEffect(sql));
