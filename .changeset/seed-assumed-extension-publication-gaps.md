---
"@supabase/pg-delta": patch
---

Fix co-located shadow seeding for an assumed extension or publication whose members or memberships were pruned from the managed view, and omit seed objects that use a member of an extension the seed leaves out.
