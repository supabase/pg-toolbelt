---
"@supabase/pg-delta": patch
---

Speed up declarative `schema apply`: routine bodies are re-validated in a few round trips instead of one per routine, and the target is extracted while the shadow loads unless the shadow is on the target's server or on a clone of its data directory.
