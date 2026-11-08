---
"@supabase/pg-delta": patch
---

fix(pg-delta): the Spark source treats roles named by policies (`authenticated`, `anon`, ...) as ambient, so `spark export` and `spark plan` no longer fail with `consumes role:...` on a policy `TO <role>`.
