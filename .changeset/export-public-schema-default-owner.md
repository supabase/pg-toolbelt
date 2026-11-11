---
"@supabase/pg-delta": patch
---

Keep `ALTER SCHEMA "public" OWNER TO <default owner>` in `schema export` on PG15+ when `public` is owned by the default owner, so a declarative sync of the unchanged export no longer plans `REVOKE`/`GRANT` churn on `public`.
