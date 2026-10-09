---
"@supabase/pg-delta": patch
---

Keep user grants on objects of non-platform extensions in schema `extensions` (e.g. `GRANT EXECUTE ON FUNCTION extensions.similarity(text, text) TO authenticated`) in the declarative export, so `declarative sync` no longer drops them. Trees exported before this release need those `GRANT` lines added next to their `CREATE EXTENSION`, or `declarative sync` plans a `REVOKE` for them.
