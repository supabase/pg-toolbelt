---
"@supabase/pg-delta": patch
---

Fix domains with `NOT NULL` extracted from PostgreSQL 17+. The catalog stores a domain NOT NULL as a `pg_constraint` row (`contype = 'n'`), which the extractor turned into a second constraint fact next to the domain's `notNull` attribute. `CREATE DOMAIN` then rendered `… NOT NULL … CONSTRAINT "<domain>_not_null" NOT NULL`, which PostgreSQL rejects (`constraint … already exists`), toggling NOT NULL emitted a redundant `ADD/DROP CONSTRAINT`, and every extract reported a spurious `dangling_edge` warning for the row. NOT NULL is now modeled only by the domain attribute, identically on PG 14–18; a user-chosen name for the NOT NULL constraint is not preserved.
