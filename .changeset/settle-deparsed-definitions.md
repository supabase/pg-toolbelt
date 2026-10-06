---
"@supabase/pg-delta": patch
---

Declarative plans no longer re-emit definitions that Postgres rewrites when replaying them (#510). A row-wise `IS [NOT] DISTINCT FROM` over three or more columns is deparsed as nested `OR`s but re-parsed flat, so triggers, views, materialized views, check and domain constraints, indexes, policies, defaults, generated columns, rules, SQL-standard function bodies and publication row filters written that way were rebuilt on every sync. When a definition's text differs from the target's, the shadow database now replays it until the text matches the target or stops changing (rows nested inside rows take more than one replay), and the plan compares the replayed text. Each rewritten definition raises a `deparse_rewritten` warning that quotes the form Postgres stores, so the declarative file can be updated and the extra replays avoided.
