/**
 * Sensitive-option redaction for foreign-data-wrapper objects.
 *
 * Foreign servers (`pg_foreign_server.srvoptions`) and user mappings
 * (`pg_user_mapping.umoptions`) store libpq/FDW credentials in cleartext.
 * Any code path that emits these option values verbatim — plan SQL, catalog
 * snapshots, declarative export, fingerprints — leaks the credentials to
 * disk, stdout, CI logs, and version control.
 *
 * To prevent this, replace values whose option key is in
 * {@link SENSITIVE_OPTION_KEYS} with a stable `__OPTION_<KEY>__` placeholder.
 * Non-sensitive options (`host`, `port`, `user`, `dbname`, …) pass through
 * unchanged so they continue to roundtrip.
 *
 * The denylist is keyed exactly (case-insensitive) — not a substring match —
 * so an option named e.g. `password_validator_extension` would not be
 * redacted. Add the literal key here if you need to cover a new FDW.
 *
 * Tracked in CLI-1467.
 */

const SENSITIVE_OPTION_KEYS = new Set<string>([
  // libpq / postgres_fdw, dblink, oracle_fdw, mysql_fdw, mssql_fdw,
  // redis_fdw, mongo_fdw, clickhouse_fdw, …
  "password",
  "passfile",
  "passcode",
  "sslpassword",
  // Third-party / Supabase Wrappers and common cloud-service FDWs.
  // Sources include https://github.com/supabase/wrappers and the libpq
  // / FDW docs. Add keys here as new wrappers are integrated.
  "api_key",
  "apikey",
  "secret",
  "secret_key",
  "private_key",
  "access_token",
  "auth_token",
  "bearer_token",
  "client_secret",
  "aws_secret_access_key",
  "aws_session_token",
  "sa_key",
]);

function redactedOptionPlaceholder(key: string): string {
  return `__OPTION_${key.toUpperCase()}__`;
}

export function redactOptionValue(key: string, value: string): string {
  return SENSITIVE_OPTION_KEYS.has(key.toLowerCase())
    ? redactedOptionPlaceholder(key)
    : value;
}

/**
 * Redact sensitive values in a flat `[key, value, key, value, ...]` options
 * array — the shape used by the {@link Server} and {@link UserMapping} models.
 */
export function redactSensitiveOptionPairs(
  options: readonly string[] | null,
): string[] | null {
  if (!options || options.length === 0) {
    return options ? [...options] : options;
  }
  const result: string[] = [];
  for (let i = 0; i < options.length; i += 2) {
    const key = options[i];
    const value = options[i + 1];
    if (key === undefined || value === undefined) continue;
    result.push(key, redactOptionValue(key, value));
  }
  return result.length > 0 ? result : null;
}
