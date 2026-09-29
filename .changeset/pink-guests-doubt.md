---
"@supabase/pg-topo": patch
---

Support PostgreSQL range type ordering in pg-topo, including calls to a range's generated constructor functions. Unqualified built-in type names (e.g. `int4`) now resolve to `pg_catalog`, so calls with keyword casts like `1::integer` match functions declared with `int4` parameters.
