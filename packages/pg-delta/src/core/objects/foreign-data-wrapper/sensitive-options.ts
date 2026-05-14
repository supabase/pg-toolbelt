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
 * Tracked in CLI-1467.
 */

const SENSITIVE_OPTION_KEYS = new Set<string>([
  "password",
  "passfile",
  "passcode",
  "sslpassword",
]);

export function isSensitiveOptionKey(key: string): boolean {
  return SENSITIVE_OPTION_KEYS.has(key.toLowerCase());
}

function redactedOptionPlaceholder(key: string): string {
  return `__OPTION_${key.toUpperCase()}__`;
}

export function redactOptionValue(key: string, value: string): string {
  return isSensitiveOptionKey(key) ? redactedOptionPlaceholder(key) : value;
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
