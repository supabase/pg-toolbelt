---
"@supabase/pg-delta": minor
---

feat(pg-delta): apply accepts a pre-extracted source fact base for the fingerprint gate

`apply()` re-extracted the target on every gated call so the fingerprint could
be compared to the plan's source. Callers that already extracted the target they
planned from — and still hold exclusive write access — can now pass that raw
`FactBase` as `sourceFactBase`. The gate reconstructs the same managed view and
skips the extract; a mismatched base still fails. Default behaviour (re-extract)
is unchanged when the option is absent. `schema apply` threads the fact base
from `planSchemaFiles` because that path plans and applies in one process.

`sourceFactBase` is only valid when nothing else can write to the target between
plan and apply; the caller is asserting that. `fingerprintGate: false` remains
the escape hatch that drops the check entirely.
