/**
 * Connection URL normalization for pg-delta.
 *
 * Auto-normalizes percent-encoded IPv6 hosts in PostgreSQL connection URLs.
 * A URL like `postgresql://user:pass@2406%3Ada18%3A...%3Ab3c9:5432/db`
 * becomes `postgresql://user:pass@[2406:da18:...:b3c9]:5432/db` before it
 * reaches `pg-connection-string` / `pg.Pool`, so DNS resolution sees the
 * address in its canonical bracketed form.
 *
 * Non-IPv6 hosts (IPv4, DNS names, already-bracketed IPv6, partial fragments
 * that just happen to contain `%3A`) are returned verbatim.
 */

// IPv6 detection regex vendored from ip-regex (Sindre Sorhus, MIT).
// https://github.com/sindresorhus/ip-regex
const v4 =
  "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]\\d|\\d)){3}";
const v6seg = "[a-fA-F\\d]{1,4}";
const v6 = `
(?:
(?:${v6seg}:){7}(?:${v6seg}|:)|
(?:${v6seg}:){6}(?:${v4}|:${v6seg}|:)|
(?:${v6seg}:){5}(?::${v4}|(?::${v6seg}){1,2}|:)|
(?:${v6seg}:){4}(?:(?::${v6seg}){0,1}:${v4}|(?::${v6seg}){1,3}|:)|
(?:${v6seg}:){3}(?:(?::${v6seg}){0,2}:${v4}|(?::${v6seg}){1,4}|:)|
(?:${v6seg}:){2}(?:(?::${v6seg}){0,3}:${v4}|(?::${v6seg}){1,5}|:)|
(?:${v6seg}:){1}(?:(?::${v6seg}){0,4}:${v4}|(?::${v6seg}){1,6}|:)|
(?::(?:(?::${v6seg}){0,5}:${v4}|(?::${v6seg}){1,7}|:))
)(?:%[0-9a-zA-Z]{1,})?
`
  .replace(/\s*\/\/.*$/gm, "")
  .replace(/\n/g, "")
  .trim();

const V6_EXACT = new RegExp(`^${v6}$`);

/**
 * Return true if `value` is a valid IPv6 literal in any canonical form:
 * full 8-group, `::` compression, or IPv4-mapped (`::ffff:1.2.3.4`).
 * RFC 4007 zone identifiers (`fe80::1%eth0`) are accepted.
 */
export function isIPv6(value: string): boolean {
  return typeof value === "string" && V6_EXACT.test(value);
}

/**
 * Normalize a PostgreSQL connection URL so IPv6 hosts reach pg in the
 * canonical bracketed form.
 *
 * If the URL's hostname contains a percent-encoded colon AND the decoded
 * hostname is a valid IPv6 literal, the hostname is decoded and wrapped in
 * `[...]`. All other fields (scheme, userinfo, port, path, query, fragment)
 * are preserved byte-for-byte from the input.
 *
 * Any URL whose decoded hostname does not validate as IPv6 is returned
 * verbatim, so a malformed input will surface its usual downstream error
 * instead of being silently rewritten.
 */
export function normalizeConnectionUrl(url: string): string {
  const urlObj = new URL(url);
  // Cheap pre-filter: only look closer if the hostname contains a
  // percent-encoded colon. Anything else is left entirely untouched.
  if (!/%3[aA]/.test(urlObj.hostname)) return url;

  const decodedHost = decodeURIComponent(urlObj.hostname);
  // Authoritative validation: only normalize when the decoded string is a
  // real IPv6 literal. Rejects partial fragments, random hostnames that
  // happen to contain `%3A`, and any malformed input.
  if (!isIPv6(decodedHost)) return url;

  // Preserve username/password/port/path/search/hash exactly as they appear
  // in the WHATWG URL model (these are returned already percent-encoded).
  const scheme = `${urlObj.protocol}//`;
  const auth = urlObj.username
    ? urlObj.password
      ? `${urlObj.username}:${urlObj.password}@`
      : `${urlObj.username}@`
    : "";
  const port = urlObj.port ? `:${urlObj.port}` : "";
  const tail = `${urlObj.pathname}${urlObj.search}${urlObj.hash}`;
  return `${scheme}${auth}[${decodedHost}]${port}${tail}`;
}
