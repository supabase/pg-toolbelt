---
"@supabase/pg-delta": patch
---

A sequence linked to the same table in both states (serial or `OWNED BY`) no longer gets its own `ALTER SEQUENCE … OWNER TO` when the table changes owner. `ALTER TABLE … OWNER TO` already carries it, and Postgres refuses to re-own a linked sequence by itself (`cannot change owner of sequence`), so such plans failed for every applier, superusers included.
