---
"@supabase/pg-delta": patch
---

Fix async pool session setup so declarative export no longer triggers concurrent `client.query()` deprecation warnings during catalog extraction.
