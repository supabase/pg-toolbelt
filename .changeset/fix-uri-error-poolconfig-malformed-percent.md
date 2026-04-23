---
"@supabase/pg-delta": patch
---

fix(pg-delta): handle malformed percent-encoding in connection URLs

`poolConfigFromUrl` and `normalizeConnectionUrl` used `decodeURIComponent` directly on the URL's userinfo, database name, and hostname. A bare `%` or a truncated escape like `%x` in any of those fields raised `URIError: URI malformed`, crashing `createManagedPool` before a connection attempt was made (Sentry `SUPABASE-API-7TV`).

Both call sites now route through a new `safeDecodeURIComponent` helper that returns the input unchanged on `URIError`, so connections with a literal `%` in their password proceed to a normal auth/connect outcome instead of a synchronous crash. Valid percent-encoded values continue to decode as before.
