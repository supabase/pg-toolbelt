---
"@supabase/pg-delta": patch
---

Fix declarative export debug logging so regex patterns containing curly braces are logged correctly instead of being interpreted as log template placeholders.
