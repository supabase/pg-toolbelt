---
"@supabase/pg-delta": patch
---

Fix Supabase declarative export for `pgmq` by allowing the integration serializer to omit `WITH SCHEMA` during extension creation, so exported schemas can be applied to a fresh database. Formalize serializer option typing with a shared `SerializeOptions` contract so integration DSL options and change serializers stay in sync.
