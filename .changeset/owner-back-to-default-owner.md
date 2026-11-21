---
"@supabase/pg-delta": patch
---

Plan `ALTER … OWNER TO` when an object's owner moves from a custom role back to the default owner, so the plan converges instead of leaving the old owner in place. This covers a default owner declared by the profile's policy as well as the run-level `defaultOwner` option.
