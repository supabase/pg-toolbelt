---
"@supabase/pg-delta": patch
---

fix(pg-delta): clear the connect-timeout timer when the race settles

`createManagedPool` raced `pool.connect()` against a `setTimeout` rejection but never cleared the timer. When the connect won (the normal, fast case), the pending `setTimeout` kept the event loop alive, so the process hung for the rest of `PGDELTA_CONNECT_TIMEOUT_MS` even though the plan was already done. Raising the timeout for far-away databases made every local run wait that long too. The race now goes through a `connectWithTimeout` helper that clears the timer in a `.finally`.
