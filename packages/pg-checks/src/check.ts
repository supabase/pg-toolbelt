/**
 * SQL the executors append to a migration (RFC §3) and run after commit (RFC §4).
 * Every function call is `pg_catalog`-qualified: these statements run under the
 * migration's own `search_path`, which may put a user schema before pg_catalog.
 */
import { type ResolvedPolicy, type Rule, rulesAt } from "./policy.ts";
import { SPLINTER_QUERY } from "./vendor/splinter.ts";

export interface CheckOptions {
  /** Timeout of the check statement alone. Default 2000 (D23). */
  readonly timeoutMs?: number;
  /** Schemas exposed through the Data API (`[api].schemas`). Default `["public"]`. */
  readonly exposedSchemas?: readonly string[];
}

/** SQLSTATE raised when a rule at `error` has a finding. */
export const CHECK_FAILED_SQLSTATE = "SB001";
/** SQLSTATE raised when the check itself exceeds its timeout. */
export const CHECK_TIMED_OUT_SQLSTATE = "SB002";

/** A Postgres string literal, safe under either `standard_conforming_strings`. */
export function quoteLiteral(value: string): string {
  const quoted = `'${value.replaceAll("'", "''")}'`;
  return value.includes("\\") ? `E${quoted.replaceAll("\\", "\\\\")}` : quoted;
}

const textArray = (values: readonly string[]) =>
  `array[${values.map(quoteLiteral).join(", ")}]::pg_catalog.text[]`;

function dbSchemas(options: CheckOptions): string {
  const schemas = options.exposedSchemas ?? ["public"];
  for (const schema of schemas) {
    // Splinter splits pgrst.db_schemas on commas.
    if (schema.includes(","))
      throw new Error(
        `exposed schema ${JSON.stringify(schema)} contains a comma`,
      );
  }
  return schemas.join(",");
}

/** The splinter query restricted to `rules`, minus excluded relations. */
function lintSelect(
  columns: string,
  rules: readonly Rule[],
  exclude: readonly string[],
): string {
  const excluded =
    exclude.length === 0
      ? ""
      : `\n  and not coalesce((l.metadata->>'schema') || '.' || (l.metadata->>'name') = any(${textArray(exclude)}), false)`;
  return `select ${columns}
from (
${SPLINTER_QUERY}
) l
where l.name = any(${textArray(rules)})${excluded}`;
}

/**
 * The check statements, in order. Empty when no rule is at `error`. Executors
 * that pipeline statements (CLI) append these individually; others join them
 * ({@link buildCheckBlock}).
 */
export function buildCheckStatements(
  policy: ResolvedPolicy,
  options: CheckOptions,
): string[] {
  const errors = rulesAt(policy, "error");
  if (errors.length === 0) return [];
  const warnings = rulesAt(policy, "warn");
  const timeoutMs = options.timeoutMs ?? 2000;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`timeoutMs must be a positive integer, got ${timeoutMs}`);
  }
  const select = lintSelect(
    `pg_catalog.jsonb_build_object(
  'errors', coalesce(pg_catalog.jsonb_agg(l) filter (where l.name = any(${textArray(errors)})), '[]'::pg_catalog.jsonb),
  'warnings', coalesce(pg_catalog.jsonb_agg(l) filter (where l.name = any(${textArray(warnings)})), '[]'::pg_catalog.jsonb))`,
    [...errors, ...warnings],
    policy.exclude,
  );
  // The timeout must be set by its own statement: the timer starts with the
  // statement, so setting it inside the DO has no effect (RFC §3.1). search_path
  // and pgrst.db_schemas are saved and restored inside the DO; on a raise the
  // transaction aborts, so only the success path restores.
  const check = `do $sbc$
declare
  prev_search_path pg_catalog.text := pg_catalog.current_setting('search_path');
  prev_db_schemas pg_catalog.text := pg_catalog.current_setting('pgrst.db_schemas', true);
  findings pg_catalog.jsonb;
begin
  perform pg_catalog.set_config('search_path', '', true);
  perform pg_catalog.set_config('pgrst.db_schemas', ${quoteLiteral(dbSchemas(options))}, true);
  begin
    execute $sbcq$
${select}
$sbcq$ into findings;
  exception when query_canceled then
    raise exception using errcode = '${CHECK_TIMED_OUT_SQLSTATE}', message = 'security check timed out',
      hint = 'retry with --skip-checks, or raise the check timeout';
  end;
  if pg_catalog.jsonb_array_length(findings->'errors') > 0 then
    raise exception using errcode = '${CHECK_FAILED_SQLSTATE}', message = 'security check failed',
      detail = findings::pg_catalog.text;
  end if;
  perform pg_catalog.set_config('search_path', prev_search_path, true);
  perform pg_catalog.set_config('pgrst.db_schemas', coalesce(prev_db_schemas, ''), true);
end
$sbc$`;
  return [
    "select pg_catalog.set_config('sbc.statement_timeout', pg_catalog.current_setting('statement_timeout'), true)",
    `set local statement_timeout = '${timeoutMs}ms'`,
    check,
    "select pg_catalog.set_config('statement_timeout', pg_catalog.current_setting('sbc.statement_timeout'), true)",
  ];
}

/** {@link buildCheckStatements} as one script, or `""` when no rule is at `error`. */
export function buildCheckBlock(
  policy: ResolvedPolicy,
  options: CheckOptions,
): string {
  return joinStatements(buildCheckStatements(policy, options));
}

export interface AfterCommitRead {
  /** Run in order on one connection, outside any transaction. */
  readonly statements: readonly string[];
  /** Index in {@link statements} of the statement whose rows are the findings. */
  readonly resultIndex: number;
  /** The statements as one script. */
  readonly sql: string;
}

/**
 * Plain lint read for rules at `warn` and `error` (RFC §4). Wrapped in its own
 * transaction and rolled back so the `set_config(..., true)` calls stay local
 * (O23). Empty when every rule is `off`.
 */
export function buildAfterCommitRead(
  policy: ResolvedPolicy,
  options: Pick<CheckOptions, "exposedSchemas">,
): AfterCommitRead {
  const rules = [...rulesAt(policy, "error"), ...rulesAt(policy, "warn")];
  if (rules.length === 0) return { statements: [], resultIndex: -1, sql: "" };
  const statements = [
    "begin",
    `select pg_catalog.set_config('search_path', '', true), pg_catalog.set_config('pgrst.db_schemas', ${quoteLiteral(dbSchemas(options))}, true)`,
    lintSelect("l.*", rules, policy.exclude),
    "rollback",
  ];
  return { statements, resultIndex: 2, sql: joinStatements(statements) };
}

const joinStatements = (statements: readonly string[]) =>
  statements.length === 0 ? "" : `${statements.join(";\n")};\n`;
