---
"@supabase/pg-topo": patch
---

Resolve `COMMENT ON RULE` dependencies so comments are ordered after the rule they target. `objectKindFromObjType` now maps `OBJECT_RULE`, and rule comment refs use the same `relation.objectName` identity as triggers and policies. Plain views now also provide their implicit `_RETURN` rewrite rule, so `COMMENT ON RULE "_RETURN" ON <view>` resolves to the view instead of reporting an unresolved dependency.
