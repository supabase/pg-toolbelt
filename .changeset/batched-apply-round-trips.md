---
"@supabase/pg-delta": minor
---

Apply can send each transactional segment as bounded multi-statement
simple-protocol queries (plus a separate COMMIT). This is opt-in
(`batchTransactional` / `--batch-transactional`); the default remains one
query per action. Mid-batch failures are attributed from error.position
when Postgres sends it, otherwise CommandComplete count. Non-transactional
segments and `inDoubt` COMMIT semantics are unchanged.
