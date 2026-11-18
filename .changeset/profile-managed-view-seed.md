---
"@supabase/pg-delta": minor
---

`ResolvedProfile` gains `managedView(factBase, { scope, defaultOwner })`, the view `plan()` diffs under this profile, and `assumedSchemaSeed(targetFactBase, { scope })`, the SQL `planSchemaFiles({ seedAssumedSchemas: true })` replays into a co-located shadow. `AssumedSchemaSeed` is now exported, and hand-built `ResolvedProfile` implementations must add both members.
