---
"@supabase/pg-checks": minor
---

First release of `@supabase/pg-checks`: security checks on migration apply. It vendors splinter 2026.09.1 split per rule, validates the `[db.migrations.checks]` policy, builds the in-transaction check block (`SB001` blocked, `SB002` timed out) and the warn reads (after commit, or before commit for one-string executors), and parses findings with fix suggestions.
