---
"@supabase/pg-delta": patch
---

Speed up loading declarative files into the shadow database: the load session now runs with `synchronous_commit = off`, so the per-file commits no longer wait for a WAL flush. A no-op `declarative sync` on the benchmark fixture drops from about 11 s to about 2.2 s locally.
