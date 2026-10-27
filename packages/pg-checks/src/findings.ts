/** Findings in the RFC §8 shape, from the check's `DETAIL` or the after-commit read. */
import {
  CHECK_FAILED_SQLSTATE,
  CHECK_TIMED_OUT_SQLSTATE,
  WARN_READ_COLUMN,
} from "./check.ts";
import { fixText } from "./fix.ts";
import { RULES, type ResolvedPolicy, type Rule } from "./policy.ts";

export interface Finding {
  readonly rule: Rule;
  readonly severity: "error" | "warn";
  readonly schema: string | null;
  readonly name: string | null;
  readonly type: string | null;
  /** Splinter's own `level` for the rule, independent of the policy severity. */
  readonly splinterLevel: SplinterLevel | null;
  readonly detail: string;
  /** What to change, naming the object (pg-checks' own text, O13). */
  readonly fix: string;
  /** Splinter's `remediation`: the rule's docs URL. */
  readonly docs: string | null;
}

export type SplinterLevel = "ERROR" | "WARN" | "INFO";

const SPLINTER_LEVELS: readonly unknown[] = ["ERROR", "WARN", "INFO"];

export type CheckError =
  | {
      readonly kind: "blocked";
      readonly errors: Finding[];
      /** At most `DETAIL_WARNING_LIMIT` rows; see {@link warningCount}. */
      readonly warnings: Finding[];
      /** Every warning finding, including those cut from {@link warnings}. */
      readonly warningCount: number;
    }
  | { readonly kind: "timed_out"; readonly message: string };

const isRule = (value: unknown): value is Rule =>
  typeof value === "string" && (RULES as readonly string[]).includes(value);

const stringOrNull = (value: unknown) =>
  typeof value === "string" ? value : null;

function toFinding(row: unknown, severity: "error" | "warn"): Finding | null {
  if (typeof row !== "object" || row === null) return null;
  const record = row as Record<string, unknown>;
  if (!isRule(record["name"])) return null;
  const metadata = (
    typeof record["metadata"] === "object" && record["metadata"] !== null
      ? record["metadata"]
      : {}
  ) as Record<string, unknown>;
  return {
    rule: record["name"],
    severity,
    schema: stringOrNull(metadata["schema"]),
    name: stringOrNull(metadata["name"]),
    type: stringOrNull(metadata["type"]),
    splinterLevel: SPLINTER_LEVELS.includes(record["level"])
      ? (record["level"] as SplinterLevel)
      : null,
    detail: stringOrNull(record["detail"]) ?? "",
    fix: fixText(record["name"], metadata),
    docs: stringOrNull(record["remediation"]),
  };
}

/** Splinter rows (after-commit read) as findings; rules at `off` are dropped. */
export function parseFindings(
  rows: readonly unknown[],
  policy: ResolvedPolicy,
): Finding[] {
  return rows.flatMap((row) => {
    const rule = (row as { name?: unknown } | null)?.name;
    if (!isRule(rule)) return [];
    const severity = policy.severities[rule];
    if (severity === "off") return [];
    const finding = toFinding(row, severity);
    return finding === null ? [] : [finding];
  });
}

/**
 * The rows a one-string executor got back for a migration that ended with
 * {@link buildInTransactionWarnRead}. The sentinel row is found by column name
 * (pg-meta returns the last result that has rows); without it, nothing in
 * `rows` is taken for findings.
 */
export function parseInTransactionWarnRead(
  rows: readonly unknown[],
  policy: ResolvedPolicy,
): { readonly findings: Finding[] } | { readonly readError: string } {
  const sentinel = rows.findLast(
    (row) => typeof row === "object" && row !== null && WARN_READ_COLUMN in row,
  ) as Record<string, unknown> | undefined;
  if (sentinel === undefined) {
    return { readError: `no ${WARN_READ_COLUMN} row in the result` };
  }
  const value = sentinel[WARN_READ_COLUMN];
  let parsed: { findings?: unknown; read_error?: unknown };
  try {
    parsed = JSON.parse(String(value)) as typeof parsed;
  } catch {
    return { readError: `unreadable ${WARN_READ_COLUMN}: ${String(value)}` };
  }
  if (typeof parsed?.read_error === "string") {
    return { readError: parsed.read_error };
  }
  if (!Array.isArray(parsed?.findings)) {
    return { readError: `unreadable ${WARN_READ_COLUMN}: ${String(value)}` };
  }
  return { findings: parseFindings(parsed.findings, policy) };
}

const QUERY_CANCELED_SQLSTATE = "57014";

/**
 * The check's own failure, from a driver error carrying `code` and `detail`
 * (node-postgres `DatabaseError`, pg-meta's error body). `null` for any other error.
 * Pass `fromCheck` when the executor knows the error came from a check statement.
 */
export function parseCheckError(
  error: unknown,
  options: { readonly fromCheck?: boolean } = {},
): CheckError | null {
  if (typeof error !== "object" || error === null) return null;
  const { code, message, detail } = error as {
    code?: unknown;
    message?: unknown;
    detail?: unknown;
  };
  if (code === CHECK_TIMED_OUT_SQLSTATE) {
    return {
      kind: "timed_out",
      message: stringOrNull(message) ?? "security check timed out",
    };
  }
  // A cancel while Postgres compiles the check's DO escapes its handler. Only
  // the executor knows which statement failed, so it says so.
  if (code === QUERY_CANCELED_SQLSTATE && options.fromCheck === true) {
    return {
      kind: "timed_out",
      message: stringOrNull(message) ?? "security check timed out",
    };
  }
  if (code !== CHECK_FAILED_SQLSTATE) return null;
  let parsed: { errors?: unknown; warnings?: unknown; warning_count?: unknown };
  try {
    parsed = JSON.parse(String(detail)) as typeof parsed;
  } catch (cause) {
    throw new Error(
      `security check failed with an unreadable DETAIL: ${String(detail)}`,
      { cause },
    );
  }
  const collect = (rows: unknown, severity: "error" | "warn") =>
    (Array.isArray(rows) ? rows : []).flatMap((row) => {
      const finding = toFinding(row, severity);
      return finding === null ? [] : [finding];
    });
  const warnings = collect(parsed.warnings, "warn");
  return {
    kind: "blocked",
    errors: collect(parsed.errors, "error"),
    warnings,
    warningCount:
      typeof parsed.warning_count === "number"
        ? parsed.warning_count
        : warnings.length,
  };
}
