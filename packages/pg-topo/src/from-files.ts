import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { analyzeAndSort } from "./analyze-and-sort.ts";
import { discoverSqlFiles } from "./ingest/discover.ts";
import type { AnalyzeResult, Diagnostic } from "./model/types.ts";

const computeCommonBase = async (resolvedRoots: string[]): Promise<string> => {
  if (resolvedRoots.length === 0) {
    return process.cwd();
  }

  // Normalise each root to its directory (file roots use their parent)
  const dirs: string[] = [];
  for (const root of resolvedRoots) {
    const rootStats = await stat(root).catch(() => undefined);
    dirs.push(rootStats?.isFile() ? path.dirname(root) : root);
  }

  if (dirs.length === 1) {
    return dirs[0];
  }

  const segments = dirs.map((d) => d.split(path.sep));
  const common: string[] = [];
  for (let i = 0; i < (segments[0]?.length ?? 0); i += 1) {
    const seg = segments[0]?.[i];
    if (seg !== undefined && segments.every((s) => s[i] === seg)) {
      common.push(seg);
    } else {
      break;
    }
  }
  return common.join(path.sep) || path.sep;
};

const toStablePath = (absolutePath: string, basePath: string): string =>
  path.relative(basePath, absolutePath).split(path.sep).join("/");

export const analyzeAndSortFromFiles = async (
  roots: string[],
): Promise<AnalyzeResult> => {
  if (roots.length === 0) {
    return {
      ordered: [],
      diagnostics: [
        {
          code: "DISCOVERY_ERROR",
          message:
            "No roots provided. Pass at least one SQL file or directory root.",
        },
      ],
      graph: {
        nodeCount: 0,
        edges: [],
        cycleGroups: [],
      },
    };
  }

  const discovery = await discoverSqlFiles(roots);
  const discoveryDiagnostics: Diagnostic[] = [];

  for (const missingRoot of discovery.missingRoots) {
    discoveryDiagnostics.push({
      code: "DISCOVERY_ERROR",
      message: `Root does not exist: '${missingRoot}'.`,
    });
  }

  const resolvedRoots = roots.map((r) => path.resolve(r));
  const basePath = await computeCommonBase(resolvedRoots);

  const sqlContents: string[] = [];
  for (const filePath of discovery.files) {
    const content = await readFile(filePath, "utf-8");
    sqlContents.push(content);
  }

  const result = await analyzeAndSort(sqlContents);

  // Remap synthetic source labels (<input:N>) back to stable file paths
  const filePathMap = new Map<string, string>();
  for (let i = 0; i < discovery.files.length; i += 1) {
    filePathMap.set(`<input:${i}>`, toStablePath(discovery.files[i], basePath));
  }

  const remapFilePath = (filePath: string): string =>
    filePathMap.get(filePath) ?? filePath;

  const remappedOrdered = result.ordered.map((node) => ({
    ...node,
    id: {
      ...node.id,
      filePath: remapFilePath(node.id.filePath),
    },
  }));

  const remappedDiagnostics = [
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
  ];

  const remappedGraph = {
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
  };

  return {
    ordered: remappedOrdered,
    diagnostics: remappedDiagnostics,
    graph: remappedGraph,
  };
};
