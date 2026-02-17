import type { ObjectRef, StatementId } from "../../../src/model/types";

export type DatabaseLikeError = {
  code?: string;
  message?: string;
};

export type SqlExecutor = {
  query: (sql: string) => Promise<unknown>;
};

export type RuntimeDiagnosticCode =
  | "RUNTIME_EXECUTION_ERROR"
  | "RUNTIME_ASSUMED_EXTERNAL_DEPENDENCY"
  | "RUNTIME_ENVIRONMENT_LIMITATION";

export type RuntimeDiagnostic = {
  code: RuntimeDiagnosticCode;
  message: string;
  statementId?: StatementId;
  objectRefs?: ObjectRef[];
  suggestedFix?: string;
  details?: Record<string, unknown>;
};
