---
"@supabase/pg-delta": patch
---

perf(extractDepends): drop redundant `new Set` copy + use codepoint comparator

`extractDepends` (`src/core/depend.ts`) merged its two underlying queries
through `new Set([...dependsRows, ...privilegeDepends])` and re-sorted via
`String#localeCompare`. Both steps were costly on realistic catalogs:

- The `Set` did no actual deduplication: rows from `pg` are fresh objects
  so identity-based membership treats every row as unique, and the two
  queries already return disjoint stable-id namespaces
  (`schema:`/`table:`/… vs `acl:`/`aclcol:`/`defacl:`/`membership:`),
  so a duplicate is impossible by construction.
- `localeCompare` is ~5× slower than codepoint comparison on long ASCII
  stable IDs and 25 k-row catalogs.

Replaced with a single `concat` + lexicographic sort. Functional output
is unchanged (length, contents, ordering up to case tiebreaks within
purely-ASCII stable IDs). No consumer of `catalog.depends` asserts a
specific case ordering.

Discovered while investigating catalog-extraction perf for #250 — the
EXPLAIN ANALYZE harness landed alongside `bench:explain-extract` showed
`extractDepends` server-side cost was only ~14% of its measured wall
time, with the remainder split between wire/parse and this JS-side
post-processing.
