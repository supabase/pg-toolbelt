---
"@supabase/pg-topo": patch
---

Fix range subtype default opclass diagnostics for built-in and domain subtypes, schema-qualified array types that shadow built-ins, and external default opclass provider subtype matching. Explicit range opclass dependencies now include subtype constraints, unqualified built-in operator family names resolve through pg_catalog when no local family exists, and pg_catalog hash support routines are recognized without local producers.
