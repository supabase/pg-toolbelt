/**
 * Spark frontend: export, plan, and prove against a Spark project with no
 * Postgres involved. Both sides of every diff are Spark descriptions (the live
 * project via `GET /_spark/v1/schema`, declarative files via a scratch load),
 * and the proof re-loads the rendered plan into a scratch copy of the project.
 */
import type { Diagnostic } from "../../core/diagnostic.ts";
import type { FactBase } from "../../core/fact.ts";
import {
  exportSqlFiles,
  type ExportGrouping,
} from "../../frontends/export-sql-files.ts";
import type { SqlFile } from "../../frontends/load-sql-files.ts";
import { plan, type Plan } from "../../plan/plan.ts";
import { renderPlanSql } from "../../plan/render-sql.ts";
import type {
  SparkSchemaDescription,
  SparkStatementStatus,
} from "./description.ts";
import { sparkFactBase } from "./fact-base.ts";

/** Connection to a Spark project's admin API. */
export interface SparkConnection {
  /** Base URL of the Spark API, e.g. `http://127.0.0.1:54321`. */
  url: string;
  /** service_role key. */
  key: string;
  /** Override for tests. */
  fetch?: typeof fetch;
}

export interface SparkScratchRequest {
  base: "empty" | "current";
  order: "as_given" | "retry";
  files: SqlFile[];
}

export interface SparkScratchResult {
  statuses: SparkStatementStatus[];
  schema: SparkSchemaDescription;
}

async function sparkRequest<T>(
  conn: SparkConnection,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown } = { method: "GET" },
): Promise<T> {
  const doFetch = conn.fetch ?? fetch;
  const response = await doFetch(`${conn.url.replace(/\/+$/, "")}${path}`, {
    method: init.method,
    headers: {
      authorization: `Bearer ${conn.key}`,
      apikey: conn.key,
      ...(init.body !== undefined
        ? { "content-type": "application/json" }
        : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  if (!response.ok) {
    throw new Error(
      `spark ${init.method} ${path} failed: HTTP ${response.status} ${await response.text()}`,
    );
  }
  return (await response.json()) as T;
}

/** `GET /_spark/v1/schema`. */
export function fetchSparkSchema(
  conn: SparkConnection,
): Promise<SparkSchemaDescription> {
  return sparkRequest(conn, "/_spark/v1/schema");
}

/** `POST /_spark/v1/scratch`. */
export function sparkScratch(
  conn: SparkConnection,
  request: SparkScratchRequest,
): Promise<SparkScratchResult> {
  return sparkRequest(conn, "/_spark/v1/scratch", {
    method: "POST",
    body: {
      base: request.base,
      order: request.order,
      files: request.files.map((f) => ({ name: f.name, sql: f.sql })),
    },
  });
}

/** Spark statement statuses as diagnostics: `unsupported` and `error` are
 *  errors (the statement never reaches the project), `ignored` is info. */
export function sparkStatusDiagnostics(
  statuses: readonly SparkStatementStatus[],
): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const s of statuses) {
    if (s.status === "ok" || s.status === "rewritten") continue;
    out.push({
      code: `spark-${s.status}`,
      severity: s.status === "ignored" ? "info" : "error",
      message: `${s.file}:${s.line} ${s.kind} ${s.status}${s.message ? `: ${s.message}` : ""}`,
      context: { file: s.file, line: s.line, index: s.index, kind: s.kind },
    });
  }
  return out;
}

/** Diff two Spark fact bases into a plan (managed schemas are assumed). */
export function planSparkFactBases(
  current: FactBase,
  desired: FactBase,
  managedSchemas: readonly string[],
): { plan: Plan; sql: string } {
  const result = plan(
    current,
    desired,
    managedSchemas.length > 0 ? { assumedSchemas: [...managedSchemas] } : {},
  );
  return {
    plan: result,
    sql: result.actions.length === 0 ? "" : renderPlanSql(result),
  };
}

/** Declarative SQL files for a Spark description (grouped layout by default,
 *  the same shape `schema export --layout grouped` writes). */
export function exportSparkSchema(
  description: SparkSchemaDescription,
  options: {
    layout?: "by-object" | "ordered" | "grouped";
    grouping?: ExportGrouping;
  } = {},
): SqlFile[] {
  return exportSqlFiles(sparkFactBase(description), {
    layout: options.layout ?? "grouped",
    ...(options.grouping !== undefined ? { grouping: options.grouping } : {}),
    ...(description.managed_schemas.length > 0
      ? { assumedSchemas: [...description.managed_schemas] }
      : {}),
  });
}

export interface SparkPlanResult {
  /** Rendered migration SQL; empty when there are no changes. */
  sql: string;
  plan: Plan;
  /** Statuses of the declarative files' scratch load, as diagnostics. */
  diagnostics: Diagnostic[];
  /** Present when there was a plan to prove. */
  proof?: {
    ok: boolean;
    expected: string;
    actual: string;
    diagnostics: Diagnostic[];
  };
}

/**
 * Plan a Spark project toward declarative `files`, then prove the plan: replay
 * it on a scratch copy of the project and require the resulting fact base to
 * hash equal to the desired one.
 */
export async function planSparkSchema(
  conn: SparkConnection,
  files: SqlFile[],
): Promise<SparkPlanResult> {
  const currentDescription = await fetchSparkSchema(conn);
  const desiredLoad = await sparkScratch(conn, {
    base: "empty",
    order: "retry",
    files,
  });
  const current = sparkFactBase(currentDescription);
  const desired = sparkFactBase(desiredLoad.schema);
  const diagnostics = [
    ...sparkStatusDiagnostics(desiredLoad.statuses),
    ...current.diagnostics,
    ...desired.diagnostics,
  ];
  const managed = [
    ...new Set([
      ...currentDescription.managed_schemas,
      ...desiredLoad.schema.managed_schemas,
    ]),
  ];
  const { plan: result, sql } = planSparkFactBases(current, desired, managed);
  if (sql === "") return { sql, plan: result, diagnostics };

  const proofLoad = await sparkScratch(conn, {
    base: "current",
    order: "as_given",
    files: [{ name: "plan.sql", sql }],
  });
  const proved = sparkFactBase(proofLoad.schema);
  return {
    sql,
    plan: result,
    diagnostics,
    proof: {
      ok: proved.rootHash === desired.rootHash,
      expected: desired.rootHash,
      actual: proved.rootHash,
      diagnostics: sparkStatusDiagnostics(proofLoad.statuses),
    },
  };
}
