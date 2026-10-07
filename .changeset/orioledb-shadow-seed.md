---
"@supabase/pg-delta": minor
---

Support Supabase's OrioleDB image in co-located `schema apply`. That image sets `default_table_access_method = orioledb`, so every plain `CREATE TABLE` in the fresh shadow database failed with `access method "orioledb" does not exist`, starting with the seeded `auth.*` tables. Three changes fix it:

- A table's dependency on an extension-provided access method now resolves to an edge on that extension, so `CREATE EXTENSION` is ordered before the tables that use it.
- A new optional `assumedExtensions` policy field keeps a scope-excluded extension reference-only (like `assumedPublications`). Such an extension is never created or dropped, but the co-located shadow seed installs it.
- The Supabase profile treats `orioledb` as a platform extension and lists it in `assumedExtensions`. Comments on platform extensions are no longer diffed.
