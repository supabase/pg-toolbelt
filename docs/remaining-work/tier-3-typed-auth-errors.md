# Tier 3 — Typed auth / connection errors

- **Status**: 🟡 Redaction done; build a typed, mappable connection-error surface.
- **Linear**: CLI-1607 (typed auth-failure error + credential redaction).
- **One line**: classify Postgres connection failures into typed errors with
  stable codes so callers (the Supabase CLI / API) can map them to user-facing
  4xx and never leak credentials.

## What exists (engine substrate)

- **Credential redaction in serialized DDL is done** — corpus `sensitive-handling--*`
  / `fdw-option-secret-redaction--*` prove FDW/server/user-mapping secrets are
  redacted in output (`COVERAGE.md`).
- **Connection setup** (`packages/pg-delta-next/src/cli/pool.ts`):
  ```ts
  export function makePool(url: string): ManagedPool; // pg.Pool, max 5, silenced errors
  ```
- **CLI error convention** (`packages/pg-delta-next/src/cli/flags.ts`):
  `UsageError { exitCode = 2 }`; other failures exit 1.

## What's missing (the surface to build)

Today a bad password / unreachable host / TLS failure bubbles up as a raw
`pg`/`node` error: the message is unstructured, there is no stable code to map
to a 4xx, and there is **no guarantee the connection string (with password) is
kept out of the message**. CLI-1607 wants a typed surface.

## Implementation plan

### 1. A typed connection-error hierarchy

Add `packages/pg-delta-next/src/cli/connection-error.ts`:

```ts
export type ConnectionErrorCode =
  | "auth_failed"        // SQLSTATE 28P01 / 28000
  | "host_unreachable"   // ECONNREFUSED / ENOTFOUND / EHOSTUNREACH
  | "tls_error"          // self-signed / cert errors
  | "timeout"            // ETIMEDOUT / connect timeout
  | "db_not_found"       // SQLSTATE 3D000
  | "unknown";

export class ConnectionError extends Error {
  readonly code: ConnectionErrorCode;
  readonly exitCode: number;   // distinct from UsageError's 2
  constructor(code: ConnectionErrorCode, cause: unknown);
}
export function classifyConnectionError(cause: unknown): ConnectionError;
```

`classifyConnectionError` maps `pg` SQLSTATEs (`err.code`) and Node socket error
codes (`err.code` / `err.errno`) to a `ConnectionErrorCode`. The constructor
**must not** include the connection string or password in `message` — build the
message from the code + host/port only (parse them out, drop credentials).

### 2. Wrap connection establishment

In `makePool` / the first query each command issues (extraction connect), catch
and rethrow via `classifyConnectionError`. Keep the raw cause on `.cause` for
debug logging behind a verbose flag — but never in the default message.

### 3. Map at the CLI boundary

Command handlers translate a `ConnectionError` into a stable exit code +
single-line stderr (`error: auth_failed: password authentication failed for host
db.example.com`). Document the code→4xx mapping for API consumers (e.g.
`auth_failed`→401/403, `host_unreachable`/`timeout`→502/504,
`db_not_found`→404).

## Tests (RED first)

- **Unit** (`src/cli/connection-error.test.ts`): feed synthetic errors with each
  SQLSTATE / socket code and assert the mapped `ConnectionErrorCode` + that the
  message contains **no** password substring even when the cause carried a full
  connection string. Author failing first.
- **Integration** (cheap, no special image): connect with a wrong password to
  the shared cluster → `auth_failed`; connect to a closed port → either
  `host_unreachable` or `timeout`.

## Effort / risk

- **Effort**: small-medium. Pure classification + wrapping; the mapping table is
  the main content.
- **Risk**: low. No trusted-path change. The redaction assertion (no password in
  message) is the load-bearing test.

## Cross-links

- Redaction precedent: corpus `sensitive-handling--*`.
- Connection setup: `packages/pg-delta-next/src/cli/pool.ts`.
