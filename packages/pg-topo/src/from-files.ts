import path from "node:path";
import { Effect, FileSystem } from "effect";
import { analyzeAndSort } from "./analyze-and-sort.ts";
import { discoverSqlFiles } from "./ingest/discover.ts";
import type {
  AnalyzeOptions,
  AnalyzeResult,
  Diagnostic,
} from "./model/types.ts";
import { WorkingDirectory } from "./services/working-directory.ts";

const EMPTY_RESULT: AnalyzeResult = {
  ordered: [],
  diagnostics: [],
  graph: {
    nodeCount: 0,
    edges: [],
    cycleGroups: [],
  },
};

const resolveRoots = (roots: string[], cwd: string): string[] =>
  roots.map((root) => path.resolve(cwd, root));

const computeCommonBase = (
  resolvedRoots: string[],
): Effect.Effect<string, never, FileSystem.FileSystem | WorkingDirectory> =>
  Effect.gen(function* () {
    const workingDirectory = yield* WorkingDirectory;
    if (resolvedRoots.length === 0) {
      return workingDirectory.cwd;
    }

    const fs = yield* FileSystem.FileSystem;
    const dirs: string[] = [];
    for (const root of resolvedRoots) {
      const info = yield* fs
        .stat(root)
        .pipe(Effect.orElseSucceed(() => ({ type: "Directory" as const })));
      dirs.push(info.type === "File" ? path.dirname(root) : root);
    }

    if (dirs.length === 1) {
      return dirs[0];
    }

    const segments = dirs.map((directory) => directory.split(path.sep));
    const common: string[] = [];
    for (let i = 0; i < (segments[0]?.length ?? 0); i += 1) {
      const segment = segments[0]?.[i];
      if (
        segment !== undefined &&
        segments.every((otherSegments) => otherSegments[i] === segment)
      ) {
        common.push(segment);
      } else {
        break;
      }
    }
    return common.join(path.sep) || path.sep;
  });

const toStablePath = (absolutePath: string, basePath: string): string =>
  path.relative(basePath, absolutePath).split(path.sep).join("/");

const remapResult = (
  result: AnalyzeResult,
  discoveryFiles: string[],
  basePath: string,
  discoveryDiagnostics: Diagnostic[],
): AnalyzeResult => {
  const filePathMap = new Map<string, string>();
  for (let i = 0; i < discoveryFiles.length; i += 1) {
    filePathMap.set(`<input:${i}>`, toStablePath(discoveryFiles[i], basePath));
  }

  const remapFilePath = (filePath: string): string =>
    filePathMap.get(filePath) ?? filePath;

  return {
    ordered: result.ordered.map((node) => ({
      ...node,
      id: {
        ...node.id,
        filePath: remapFilePath(node.id.filePath),
      },
    })),
    diagnostics: [
      ...discoveryDiagnostics,
      ...result.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        statementId: diagnostic.statementId
          ? {
              ...diagnostic.statementId,
              filePath: remapFilePath(diagnostic.statementId.filePath),
            }
          : undefined,
      })),
    ],
    graph: {
      ...result.graph,
      edges: result.graph.edges.map((edge) => ({
        ...edge,
        from: {
          ...edge.from,
          filePath: remapFilePath(edge.from.filePath),
        },
        to: {
          ...edge.to,
          filePath: remapFilePath(edge.to.filePath),
        },
      })),
      cycleGroups: result.graph.cycleGroups.map((group) =>
        group.map((statementId) => ({
          ...statementId,
          filePath: remapFilePath(statementId.filePath),
        })),
      ),
    },
  };
};

export const analyzeAndSortFromFiles = Effect.fnUntraced(function* (
  roots: string[],
  options?: AnalyzeOptions,
) {
  if (roots.length === 0) {
    return {
      ...EMPTY_RESULT,
      diagnostics: [
        {
          code: "DISCOVERY_ERROR" as const,
          message:
            "No roots provided. Pass at least one SQL file or directory root.",
        },
      ],
    } satisfies AnalyzeResult;
  }

  const fs = yield* FileSystem.FileSystem;
  const workingDirectory = yield* WorkingDirectory;
  const discovery = yield* discoverSqlFiles(roots);
  const discoveryDiagnostics: Diagnostic[] = [];

  for (const missingRoot of discovery.missingRoots) {
    discoveryDiagnostics.push({
      code: "DISCOVERY_ERROR" as const,
      message: `Root does not exist: '${missingRoot}'.`,
    });
  }

  const resolvedRoots = resolveRoots(roots, workingDirectory.cwd);
  const basePath = yield* computeCommonBase(resolvedRoots);

  const sqlContents: string[] = [];
  for (const filePath of discovery.files) {
    const content = yield* fs
      .readFileString(filePath, "utf-8")
      .pipe(Effect.orDie);
    sqlContents.push(content);
  }

  const result = yield* analyzeAndSort(sqlContents, options);

  return remapResult(result, discovery.files, basePath, discoveryDiagnostics);
});
