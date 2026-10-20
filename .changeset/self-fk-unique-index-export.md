---
"@supabase/pg-delta": patch
---

Fix declarative export of a self-referencing foreign key that targets a unique index: the key is no longer inlined into `CREATE TABLE` before the index, so the exported files load again (#543).
