/**
 * SQL the executors append to a migration (RFC §3) and run after commit (RFC §4).
 * Every function call is `pg_catalog`-qualified: these statements run under the
 * migration's own `search_path`, which may put a user schema before pg_catalog.
 */
import { RULES, type ResolvedPolicy, type Rule, rulesAt } from "./policy.ts";
import { RULE_SQL } from "./vendor/splinter.ts";

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

/**
 * Splinter reads `coalesce(current_setting('pgrst.db_schemas', true), 'public')`.
 * Once set, the placeholder stays `''` for the rest of the session (known
 * pitfall 2), so it is set only when that would not already give the exposed
 * schemas (CLI-2826). `current` is an SQL expression for the current value.
 */
function dbSchemasDiffer(current: string, options: CheckOptions): string {
  return `coalesce(${current}, 'public') operator(pg_catalog.<>) ${quoteLiteral(dbSchemas(options))}`;
}

/** plpgsql that sets `pgrst.db_schemas` when needed, and its restore. */
function dbSchemasSteps(options: CheckOptions) {
  const differ = dbSchemasDiffer("prev_db_schemas", options);
  return {
    set: `if ${differ} then
      perform pg_catalog.set_config('pgrst.db_schemas', ${quoteLiteral(dbSchemas(options))}, true);
    end if;`,
    restore: `if ${differ} then
      perform pg_catalog.set_config('pgrst.db_schemas', coalesce(prev_db_schemas, ''), true);
    end if;`,
  };
}

function ruleSql(rule: Rule): string {
  const sql = RULE_SQL[rule];
  if (sql === undefined)
    throw new Error(`no vendored splinter SQL for ${rule}`);
  return sql;
}

/** Only `rules`' splinter SQL (D27), minus per-rule excluded objects. */
function lintSelect(
  columns: string,
  rules: readonly Rule[],
  exclude: ResolvedPolicy["exclude"],
): string {
  const excluded =
    exclude.length === 0
      ? ""
      : `\nwhere not exists (select 1 from unnest(${textArray(exclude.map((e) => e.rule))}, ${textArray(exclude.map((e) => e.object))}) as x(rule, object) where x.rule = l.name and x.object = (l.metadata->>'schema') || '.' || (l.metadata->>'name'))`;
  const union = RULES.filter((rule) => rules.includes(rule))
    .map(ruleSql)
    .join("\nunion all\n");
  return `select ${columns}
from (
${union}
) l${excluded}`;
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
  const timeoutMs = checkTimeout(options);
  const select = lintSelect(
    `pg_catalog.jsonb_build_object(
  'errors', coalesce(pg_catalog.jsonb_agg(l) filter (where l.name = any(${textArray(errors)})), '[]'::pg_catalog.jsonb),
  'warnings', coalesce(pg_catalog.jsonb_agg(l) filter (where l.name = any(${textArray(warnings)})), '[]'::pg_catalog.jsonb))`,
    [...errors, ...warnings],
    policy.exclude,
  );
  // The timeout must be set by its own statement: the timer starts with the
  // statement, so setting it inside the DO has no effect (RFC §3.1). The
  // handler spans the whole body because the cancel can land in any step, not
  // only the lint query (seen on hosted). A cancel while Postgres compiles the
  // DO is still uncatchable: executors map a raw 57014 from this statement
  // with parseCheckError(..., { fromCheck: true }). On a raise the transaction
  // aborts, so only the success path restores search_path and pgrst.db_schemas.
  const dbSchemasSet = dbSchemasSteps(options);
  const check = `do $sbc$
declare
  prev_search_path pg_catalog.text := pg_catalog.current_setting('search_path');
  prev_db_schemas pg_catalog.text := pg_catalog.current_setting('pgrst.db_schemas', true);
  findings pg_catalog.jsonb;
begin
  begin
    perform pg_catalog.set_config('search_path', '', true);
    ${dbSchemasSet.set}
    execute $sbcq$
${select}
$sbcq$ into findings;
    if pg_catalog.jsonb_array_length(findings->'errors') > 0 then
      raise exception using errcode = '${CHECK_FAILED_SQLSTATE}', message = 'security check failed',
        detail = findings::pg_catalog.text;
    end if;
    perform pg_catalog.set_config('search_path', prev_search_path, true);
    ${dbSchemasSet.restore}
  exception when query_canceled then
    raise exception using errcode = '${CHECK_TIMED_OUT_SQLSTATE}', message = 'security check timed out',
      hint = 'retry with --skip-checks, or raise the check timeout';
  end;
end
$sbc$`;
  return [
    SAVE_STATEMENT_TIMEOUT,
    `set local statement_timeout = '${timeoutMs}ms'`,
    check,
    `select ${RESTORE_STATEMENT_TIMEOUT}`,
  ];
}

function checkTimeout(options: Pick<CheckOptions, "timeoutMs">): number {
  const timeoutMs = options.timeoutMs ?? 2000;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`timeoutMs must be a positive integer, got ${timeoutMs}`);
  }
  return timeoutMs;
}

const SAVE_STATEMENT_TIMEOUT =
  "select pg_catalog.set_config('sbc.statement_timeout', pg_catalog.current_setting('statement_timeout'), true)";
const RESTORE_STATEMENT_TIMEOUT =
  "pg_catalog.set_config('statement_timeout', pg_catalog.current_setting('sbc.statement_timeout'), true)";

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
    `select pg_catalog.set_config('search_path', '', true), case when ${dbSchemasDiffer("pg_catalog.current_setting('pgrst.db_schemas', true)", options)} then pg_catalog.set_config('pgrst.db_schemas', ${quoteLiteral(dbSchemas(options))}, true) end`,
    lintSelect("l.*", rules, policy.exclude),
    "rollback",
  ];
  return { statements, resultIndex: 2, sql: joinStatements(statements) };
}

/** Column of the one row {@link buildInTransactionWarnRead} returns. */
export const WARN_READ_COLUMN = "sbc_findings";

/**
 * The warn read for one-string executors (Mgmt API, D28): placed after the
 * history insert and before `commit`, it reads rules at `warn` and `error` and
 * returns exactly one row, `sbc_findings` = `{"findings": [...]}` or
 * `{"read_error": "<sqlstate>: <message>"}`. It never raises from the lint, so a
 * slow or failing read cannot roll the migration back (a cancel while Postgres
 * compiles the DO still can; see the check block). `""` when every rule is `off`.
 */
export function buildInTransactionWarnRead(
  policy: ResolvedPolicy,
  options: CheckOptions,
): string {
  const rules = [...rulesAt(policy, "error"), ...rulesAt(policy, "warn")];
  if (rules.length === 0) return "";
  const timeoutMs = checkTimeout(options);
  const select = lintSelect(
    "coalesce(pg_catalog.jsonb_agg(l), '[]'::pg_catalog.jsonb)",
    rules,
    policy.exclude,
  );
  // The inner block is a subtransaction: on error its set_config calls are
  // undone, so the handler only records the error. statement_timeout is
  // restored inside the DO so the sentinel select and commit never run under
  // the read's timeout.
  const dbSchemasSet = dbSchemasSteps(options);
  const read = `do $sbc$
declare
  prev_search_path pg_catalog.text := pg_catalog.current_setting('search_path');
  prev_db_schemas pg_catalog.text := pg_catalog.current_setting('pgrst.db_schemas', true);
  findings pg_catalog.jsonb;
begin
  begin
    perform pg_catalog.set_config('search_path', '', true);
    ${dbSchemasSet.set}
    execute $sbcq$
${select}
$sbcq$ into findings;
    perform pg_catalog.set_config('search_path', prev_search_path, true);
    ${dbSchemasSet.restore}
    perform pg_catalog.set_config('sbc.findings', pg_catalog.jsonb_build_object('findings', findings)::pg_catalog.text, true);
  exception when query_canceled or others then
    perform pg_catalog.set_config('sbc.findings', pg_catalog.jsonb_build_object('read_error', sqlstate || ': ' || sqlerrm)::pg_catalog.text, true);
  end;
  perform ${RESTORE_STATEMENT_TIMEOUT};
end
$sbc$`;
  return joinStatements([
    SAVE_STATEMENT_TIMEOUT,
    `set local statement_timeout = '${timeoutMs}ms'`,
    read,
    `select pg_catalog.current_setting('sbc.findings', true) as ${WARN_READ_COLUMN}`,
  ]);
}

const joinStatements = (statements: readonly string[]) =>
  statements.length === 0 ? "" : `${statements.join(";\n")};\n`;
