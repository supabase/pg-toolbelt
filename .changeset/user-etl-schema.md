---
"@supabase/pg-delta": patch
---

Supabase profile: stop hiding a user's own `etl` schema. Supabase ETL's objects are owned by `supabase_etl_admin` and stay hidden by the owner rule; a user `etl` schema is now planned like any other, which fixes the "missing requirement" error on an FK into it. Plans now warn (`hidden-by-excluded-parent`) when a user-owned object is hidden only because its parent is excluded, instead of skipping it silently.
