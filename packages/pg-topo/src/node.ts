import { Layer, ManagedRuntime } from "effect";
import {
  analyzeAndSort as analyzeAndSortEffect,
  analyzeAndSortFromFiles as analyzeAndSortFromFilesEffect,
  validateSqlSyntax as validateSqlSyntaxEffect,
} from "./effect.ts";
import { nodeFileSystemLayer } from "./platform/node-filesystem.layer.ts";
import { ParserServiceLive } from "./services/parser-live.ts";
import { makeWorkingDirectoryLayer } from "./services/working-directory.ts";

const parserRuntime = ManagedRuntime.make(ParserServiceLive);

const makeFromFilesRuntime = () =>
  ManagedRuntime.make(
    Layer.mergeAll(
      ParserServiceLive,
      nodeFileSystemLayer,
      makeWorkingDirectoryLayer(process.cwd()),
    ),
  );

export * from "./effect.ts";

export const analyzeAndSort = (
  sql: Parameters<typeof analyzeAndSortEffect>[0],
  options?: Parameters<typeof analyzeAndSortEffect>[1],
) => parserRuntime.runPromise(analyzeAndSortEffect(sql, options));

export const analyzeAndSortFromFiles = (
  roots: Parameters<typeof analyzeAndSortFromFilesEffect>[0],
  options?: Parameters<typeof analyzeAndSortFromFilesEffect>[1],
) => makeFromFilesRuntime().runPromise(analyzeAndSortFromFilesEffect(roots, options));

export const validateSqlSyntax = (
  sql: Parameters<typeof validateSqlSyntaxEffect>[0],
) => parserRuntime.runPromise(validateSqlSyntaxEffect(sql));
