---
"@supabase/pg-delta": patch
---

Fix unhandled `CycleError` when dropping a FK chain of tables alongside a referenced unique constraint while only some of the involved tables are publication members. The publication FK-chain cycle breaker required every dropped table in the cycle to be a member of the publication, but publications like `supabase_realtime` commonly contain only a subset of tables; the guard now only requires the publication edge that actually participates in the cycle.
