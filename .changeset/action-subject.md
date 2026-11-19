---
"@supabase/pg-delta": minor
---

`Action` gains an optional, stable `subject`: the fact the statement changes, fixed when the action is emitted (a rename's new id, an object GRANT/REVOKE's acl). A compaction-merged GRANT/REVOKE keeps its leading member's; plan with `compact: false` for one per grantee. `planId` is unchanged.
