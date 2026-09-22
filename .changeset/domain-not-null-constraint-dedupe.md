---
"@supabase/pg-delta": patch
---

Stop rendering a domain's NOT NULL twice on PostgreSQL 17+. The catalog now stores a domain NOT NULL as a `pg_constraint` row (`contype = 'n'`), which the extractor turned into a second constraint fact next to the domain's `notNull` attribute. `CREATE DOMAIN … NOT NULL … CONSTRAINT "<domain>_not_null" NOT NULL` collapses to a single `NOT NULL`, and toggling NOT NULL on an existing domain emits only `ALTER DOMAIN … SET/DROP NOT NULL`.
