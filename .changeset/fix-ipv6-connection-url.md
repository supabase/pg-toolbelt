---
"@supabase/pg-delta": patch
---

fix(pg-delta): auto-normalize percent-encoded IPv6 hosts in connection URLs and retry transient connect failures.

Connection strings with URL-encoded IPv6 hosts (e.g. `postgresql://user:pass@2406%3Ada18%3A...%3Ab3c9:5432/db`) are now transparently rewritten to the canonical bracketed form (`[2406:da18:...:b3c9]`) before reaching `pg`, preventing `getaddrinfo ENOTFOUND` failures on the percent-encoded string. The decoded host is validated as a real IPv6 literal; anything else is passed through unchanged so downstream errors remain honest.

`createManagedPool` also retries its eager-connect probe with bounded exponential backoff on transient errors (`ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`, `EAI_AGAIN`, and its own timeout wrapper). Auth failures (`28P01`, `28000`), TLS negotiation errors, and `ENOTFOUND` still fail fast. Tunable via `PGDELTA_CONNECT_MAX_ATTEMPTS` (default 3), `PGDELTA_CONNECT_BASE_BACKOFF_MS` (default 250), and `PGDELTA_CONNECT_MAX_BACKOFF_MS` (default 1000).
