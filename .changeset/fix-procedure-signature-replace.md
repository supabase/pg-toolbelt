---
"@supabase/pg-delta": patch
---

fix(pg-delta): emit DROP + CREATE for function signature changes (return type, parameter names, parameter defaults, modes) instead of unsupported `CREATE OR REPLACE FUNCTION`
