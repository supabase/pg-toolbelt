/**
 * Sensitive-option redaction for foreign-data-wrapper objects.
 *
 * Foreign servers (`pg_foreign_server.srvoptions`) and user mappings
 * (`pg_user_mapping.umoptions`) store libpq/FDW credentials in cleartext.
 * Any code path that emits these option values verbatim — plan SQL, catalog
 * snapshots, declarative export, fingerprints — leaks the credentials to
 * disk, stdout, CI logs, and version control.
 *
 * The redaction policy is **allowlist-based**: replace every option value
 * with `__OPTION_<KEY>__` unless the option key appears in
 * {@link SAFE_OPTION_KEYS}. Failure mode of a missing entry is "the plan
 * shows the placeholder instead of the real value" — annoying, but safe;
 * a denylist's failure mode was secrets leaking, which is the bug we are
 * fixing (CLI-1467).
 *
 * Match is case-insensitive but exact — substrings do not match, so an
 * option key like `password_validator_extension` will be redacted unless
 * explicitly allowlisted. When a new wrapper introduces a non-credential
 * key we want to surface in plans, add it here.
 */

const SAFE_OPTION_KEYS = new Set<string>([
  // libpq connection params (non-credential subset).
  //   https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-PARAMKEYWORDS
  "host",
  "hostaddr",
  "port",
  "dbname",
  "user",
  "sslmode",
  "sslcompression",
  "sslcert",
  "sslkey",
  "sslrootcert",
  "sslcrl",
  "sslcrldir",
  "sslsni",
  "requirepeer",
  "krbsrvname",
  "gsslib",
  "sspi",
  "gssencmode",
  "gssdelegation",
  "channel_binding",
  "target_session_attrs",
  "application_name",
  "fallback_application_name",
  "connect_timeout",
  "client_encoding",
  "options",
  "keepalives",
  "keepalives_idle",
  "keepalives_interval",
  "keepalives_count",
  "tcp_user_timeout",
  "replication",
  "load_balance_hosts",
  // postgres_fdw behavior tuning.
  //   https://www.postgresql.org/docs/current/postgres-fdw.html#POSTGRES-FDW-OPTIONS-CONNECTION
  "use_remote_estimate",
  "fdw_startup_cost",
  "fdw_tuple_cost",
  "fetch_size",
  "batch_size",
  "async_capable",
  "analyze_sampling",
  "parallel_commit",
  "parallel_abort",
  "extensions",
  "updatable",
  "truncatable",
  "schema_name",
  "table_name",
  "column_name",
  // Common shape for table-like FDWs (file_fdw, cloud-storage wrappers).
  "schema",
  "database",
  "table",
  "format",
  "header",
  "delimiter",
  "quote",
  "escape",
  "encoding",
  "compression",
  // Cloud / Supabase Wrappers non-credential shape.
  //   https://github.com/supabase/wrappers
  "region",
  "endpoint",
  "bucket",
  "prefix",
  "location",
  "project_id",
  "dataset_id",
  "dataset",
  "workspace",
  "organization",
  "api_version",
]);

function redactedOptionPlaceholder(key: string): string {
  return `__OPTION_${key.toUpperCase()}__`;
}

export function redactOptionValue(key: string, value: string): string {
  return SAFE_OPTION_KEYS.has(key.toLowerCase())
    ? value
    : redactedOptionPlaceholder(key);
}

/**
 * Redact non-allowlisted values in a flat `[key, value, key, value, ...]`
 * options array — the shape used by the {@link Server},
 * {@link UserMapping}, {@link ForeignDataWrapper}, and {@link ForeignTable}
 * models.
 *
 * Returns `null` for `null` input, and otherwise returns an array of the
 * same length as the input with sensitive values replaced.
 */
export function redactSensitiveOptionPairs(
  options: readonly string[] | null,
): string[] | null {
  if (options === null) return null;
  const result: string[] = [];
  for (let i = 0; i < options.length; i += 2) {
    const key = options[i];
    const value = options[i + 1];
    if (key === undefined || value === undefined) continue;
    result.push(key, redactOptionValue(key, value));
  }
  return result;
}
