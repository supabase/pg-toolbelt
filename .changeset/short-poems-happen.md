---
"@supabase/pg-delta": patch
---

Use normalized object snapshots when comparing extracted catalog objects for equality so semantically identical metadata does not produce false-positive diffs.
