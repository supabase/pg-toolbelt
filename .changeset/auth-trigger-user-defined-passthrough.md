---
"@supabase/pg-delta": patch
---

fix(pg-delta): keep user-defined triggers on auth/storage tables through the supabase filter

User-attached triggers on `auth.users`, `storage.objects`, etc. were being dropped from `supabase` integration diffs because triggers live in their parent table's schema and inherit its owner — both signals the Supabase managed-schema filter uses to skip Supabase's own objects. The filter now keeps any trigger whose function lives outside the managed schemas, which is the reliable user-defined marker.
