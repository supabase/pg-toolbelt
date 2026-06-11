---
"@supabase/pg-topo": patch
---

Resolve `COMMENT ON RULE` dependencies so comments are ordered after the rule they target. `objectKindFromObjType` now maps `OBJECT_RULE`, and rule comment refs use the same `relation.objectName` identity as triggers and policies.
