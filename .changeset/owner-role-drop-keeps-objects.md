---
"@supabase/pg-delta": patch
---

Dropping a role on its own no longer forces a rebuild of the tables, views, and functions it owned: an object whose desired owner is part of the plan moves there with `ALTER … OWNER TO`, so its rows are kept.
