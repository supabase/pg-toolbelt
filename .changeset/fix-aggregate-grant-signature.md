---
"@supabase/pg-delta": patch
---

fix(pg-delta): emit valid GRANT/REVOKE syntax for ordered-set, hypothetical-set, and variadic aggregates

`GrantAggregatePrivileges` / `RevokeAggregatePrivileges` /
`RevokeGrantOptionAggregatePrivileges` previously serialized the
aggregate signature using `pg_get_function_identity_arguments`, which
embeds `ORDER BY` for ordered-set / hypothetical-set aggregates
(`aggkind` of `o` / `h`) and `VARIADIC` for variadic aggregates. The
PostgreSQL `GRANT ... ON FUNCTION` parser rejects both keywords inside
the argument list, so the generated `GRANT`/`REVOKE` failed with a
syntax error for any aggregate that wasn't a plain `aggkind = 'n'`.
The serializer now uses the `proargtypes`-derived `argument_types`
list, matching the signature shape PostgreSQL expects for `GRANT`/`REVOKE`.
