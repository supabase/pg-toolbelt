---
"@supabase/pg-delta": patch
---

Cascade policy exclusion to dependents of hard-pruned facts (reverse `depends` /
extension membership / seclabel provider), so a user trigger on an excluded
system table and TCE artefacts of excluded `pgsodium` leave the managed view
with an `excluded-by-cascade` diagnostic instead of throwing or planning
unreplayable CREATE/DROP (CLI-2300, CLI-2342). User-owned objects in assumed
schemas are hard-pruned; platform-provisioned ones stay reference-only.
Image-provisioned system extensions (`supabase_vault`, `pg_graphql`,
`pg_stat_statements`) are assumed rather than hard-pruned, so a user view over
their members still plans.
