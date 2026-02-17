import { createHash } from "node:crypto";
import type { AnalyzeResult } from "../../src/model/types";

export const analyzeResultFingerprint = (result: AnalyzeResult): string => {
  const payload = JSON.stringify({
    ordered: result.ordered.map(
      (statement) =>
        `${statement.id.filePath}:${statement.id.statementIndex}:${statement.statementClass}`,
    ),
    diagnostics: result.diagnostics.map(
      (diagnostic) =>
        `${diagnostic.code}:${
          diagnostic.statementId
            ? `${diagnostic.statementId.filePath}:${diagnostic.statementId.statementIndex}`
            : ""
        }:${diagnostic.message}`,
    ),
  });

  return createHash("sha256").update(payload).digest("hex");
};
