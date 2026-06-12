# PORTING-agent3.md

Porting log for agent3: trigger-operations, trigger-update-of-column-numbers,
event-trigger-operations, aggregate-operations, view-operations,
materialized-view-operations, index-operations, index-extension-deps.

---

## trigger-operations.test.ts (16 cases → 6 ported)

| Source test | Disposition |
|---|---|
| INSTEAD OF triggers on views are diffed and ordered after view creation | ported → `trigger-operations--instead-of-trigger-on-view` |
| simple trigger creation | not-ported — plain before-update trigger; representational coverage covered by `trigger-operations--trigger-with-when-clause` and existing `corpus/trigger/` |
| multi-event trigger | not-ported — INSERT OR DELETE OR UPDATE trigger; schema-state coverage already representative; no unique must-have property |
| multi-event trigger preserves UPDATE OF column list | ported → `trigger-operations--trigger-update-of-columns` |
| constraint trigger creation | ported → `trigger-operations--constraint-trigger-create` |
| constraint trigger update | not-ported — merged into constraint-trigger-create (drop+recreate with different DEFERRABLE); schema-state captured by create scenario |
| constraint trigger deletion | not-ported — DROP trigger; covered by `trigger-operations--trigger-drop-before-function-drop` (drop trigger + function pair) |
| constraint trigger comment alteration | not-ported — merged into `trigger-operations--trigger-comment` (comment on constraint trigger is identical in state shape to regular trigger comment) |
| conditional trigger with WHEN clause | ported → `trigger-operations--trigger-with-when-clause` |
| trigger dropping | not-ported — plain DROP TRIGGER; covered by `trigger-operations--trigger-drop-before-function-drop` (richer scenario) |
| trigger replacement (modification) | not-ported — function body change + trigger event change; asserting old-engine statement snapshot internals; schema-state captured by other scenarios |
| trigger after function dependency | not-ported — dependency ordering is an engine-internal concern; schema state covered by `trigger-operations--instead-of-trigger-on-view` |
| drop trigger before dropping trigger function | ported → `trigger-operations--trigger-drop-before-function-drop` |
| drop all triggers before dropping shared trigger function | not-ported — merged into `trigger-operations--trigger-drop-before-function-drop` (same schema-state pattern; two-table variant adds no new state shape) |
| trigger semantic equality | not-ported — asserts zero-diff on identical schemas; not a schema-state scenario (no A→B change) |
| trigger comments | ported → `trigger-operations--trigger-comment` |
| hasura event trigger function introspection | not-ported — asserts old-engine internals (statement snapshot, filter DSL, plan mechanics); remainder is commented-out TODO notes, not an active test case |

**Count: 6 ported**

---

## trigger-update-of-column-numbers.test.ts (1 case → 1 ported)

| Source test | Disposition |
|---|---|
| same-named columns on tables with different physical attnums must not produce a trigger diff | ported → `trigger-update-of-column-numbers--attnum-regression` |

**Count: 1 ported**

---

## event-trigger-operations.test.ts (6 cases → 5 ported, 1 merged)

| Source test | Disposition |
|---|---|
| create event trigger with tag filter | ported → `event-trigger-operations--create-with-tag-filter` |
| alter event trigger enabled state | ported → `event-trigger-operations--disable` |
| alter event trigger owner and comment | ported → `event-trigger-operations--owner-and-comment` (meta.json isolatedCluster — owner differs between A and B) |
| drop event trigger | ported → `event-trigger-operations--drop` (also covers comment-removal: A has trigger+comment, B has neither) |
| event trigger comment removal | merged-into `event-trigger-operations--drop` (A carries the comment; removing comment is implied by the drop; dedicated comment-removal scenario adds no distinct state) |
| event trigger creation depends on function order | ported → `event-trigger-operations--create-with-function` (schema-state: function+event-trigger exist in B, not A; dependency ordering is validated by the engine) |

**Count: 5 ported (1 merged)**

---

## aggregate-operations.test.ts (10 cases → 6 ported, 4 merged/not-ported)

| Source test | Disposition |
|---|---|
| aggregate creation | ported → `aggregate-operations--create` |
| aggregate owner change | ported → `aggregate-operations--owner-change` (meta.json isolatedCluster) |
| aggregate drop | ported → `aggregate-operations--drop` |
| aggregate comment creation | ported → `aggregate-operations--comment` |
| aggregate comment removal | not-ported — merged into `aggregate-operations--comment` (reverse direction is exercised automatically; schema-state of "comment removed" is just A having comment and B not, which is the inverse of the ported scenario) |
| aggregate comment creation depends on aggregate create order | not-ported — asserts engine-internal dependency ordering (sortChangesCallback); schema state identical to `aggregate-operations--create` + comment |
| aggregate grant privileges | ported → `aggregate-operations--grant` (meta.json isolatedCluster) |
| aggregate revoke privileges | not-ported — inverse of grant; covered by automatic bidirectional testing of `aggregate-operations--grant` |
| aggregate create + grant roundtrips without orphan grant | not-ported — regression for CLI-1471 (orphan GRANT without CREATE AGGREGATE); the engine-planner behaviour is verified by `aggregate-operations--ordered-set-create-grant` which exercises the same code path with a richer aggregate kind |
| ordered-set aggregate create + grant roundtrips without orphan grant | ported → `aggregate-operations--ordered-set-create-grant` (meta.json isolatedCluster; covers ordered-set aggkind and the CLI-1471 regression for the wildcard signature shape) |

**Count: 6 ported**

---

## view-operations.test.ts (10 cases → 6 ported, 4 not-ported)

| Source test | Disposition |
|---|---|
| simple view creation | ported → `view-operations--simple-create` |
| nested view dependencies - 3 levels deep | ported → `view-operations--nested-three-levels` |
| view replacement with dependency changes | ported → `view-operations--replace-with-new-dep` |
| recreates select-star view when base table columns change | ported → `view-operations--recreate-select-star` (must-have: b.sql has extra column so SELECT * expands differently, requiring DROP+CREATE not CREATE OR REPLACE) |
| complex view dependencies with multiple joins | not-ported — analytics multi-join pattern; schema state is a subset of `view-operations--nested-three-levels`; 6-scenario cap reached |
| valid recursive patterns are not flagged as cycles | not-ported — asserts zero false-positive diff on recursive CTE view; not a schema-state A→B change scenario |
| view comments | not-ported — covered by materialized-view-operations--comment and the comment pattern already exercised across other files; 6-scenario cap reached |
| view with options | ported → `view-operations--options` |
| view owner change | ported → `view-operations--owner-change` (meta.json isolatedCluster) |

**Count: 6 ported**

---

## materialized-view-operations.test.ts (9 cases → 6 ported, 3 not-ported)

| Source test | Disposition |
|---|---|
| create new materialized view | ported → `materialized-view-operations--create` |
| drop existing materialized view | ported → `materialized-view-operations--drop` |
| replace materialized view definition | ported → `materialized-view-operations--replace-definition` |
| replace materialized view with dependent index and view | ported → `materialized-view-operations--with-dependent-index-and-view` (must-have: cascade drop+recreate ordering) |
| restore materialized view metadata when replacing for column type rewrite | ported → `materialized-view-operations--restore-metadata-on-replace` (meta.json isolatedCluster — GRANT to role differs; covers comment+grant restoration after DROP/CREATE cycle) |
| materialized view with aggregations | not-ported — merged into replace-definition (aggregation in SELECT list already present there); 6-scenario cap reached |
| materialized view with joins | not-ported — simple CREATE with JOIN; schema state covered by `materialized-view-operations--create` |
| materialized view comments | ported → `materialized-view-operations--comment` |
| refresh materialized view does not trigger a diff | not-ported — asserts zero-diff (DML-only REFRESH, no catalog change); not a schema-state A→B scenario |

**Count: 6 ported**

---

## index-operations.test.ts (12 cases → 6 ported, 6 not-ported)

| Source test | Disposition |
|---|---|
| create btree index | ported → `index-operations--btree-and-multicolumn` (merged with multicolumn) |
| create unique index | not-ported — unique btree index; covered by `index-operations--unique-nulls-not-distinct` (a.sql has plain unique index, b.sql has NULLS NOT DISTINCT) |
| create unique index with NULLS NOT DISTINCT | ported → `index-operations--unique-nulls-not-distinct` (must-have, meta.json minVersion:15) |
| toggle unique index to NULLS NOT DISTINCT | merged-into `index-operations--unique-nulls-not-distinct` (same A→B state; a.sql = plain unique, b.sql = NULLS NOT DISTINCT) |
| toggle unique index from NULLS NOT DISTINCT | not-ported — inverse direction exercised automatically by bidirectional testing of `index-operations--unique-nulls-not-distinct` |
| create partial index | ported → `index-operations--partial` (must-have) |
| create functional index | ported → `index-operations--functional` (must-have: expression index) |
| create multicolumn index | merged-into `index-operations--btree-and-multicolumn` |
| drop index | ported → `index-operations--drop` |
| drop primary key does not emit separate drop index | not-ported — asserts engine-internal planner behaviour (no separate DROP INDEX for PK); schema-state of "constraint dropped" is captured elsewhere; asserting plan mechanics only |
| drop implicit dependent table index | not-ported — asserts plan mechanics (DROP TABLE cascades index); no standalone index-state change |
| index comments | ported → `index-operations--comment` |

**Count: 6 ported**

---

## index-extension-deps.test.ts (3 cases → 3 ported)

| Source test | Disposition |
|---|---|
| CREATE EXTENSION pg_trgm ordered before CREATE INDEX using gin_trgm_ops | ported → `index-extension-deps--basic` (must-have: extension+index ordering) |
| extension index with cross-schema dependency | ported → `index-extension-deps--cross-schema` |
| plan from null source orders extension before index | ported → `index-extension-deps--from-empty` (a.sql is empty comment; exercises the null-source plan path) |

**Count: 3 ported**

---

## Summary

| Source file | Cases | Ported | Merged-into | Not-ported |
|---|---|---|---|---|
| trigger-operations.test.ts | 16 | 6 | 0 | 10 |
| trigger-update-of-column-numbers.test.ts | 1 | 1 | 0 | 0 |
| event-trigger-operations.test.ts | 6 | 5 | 1 | 0 |
| aggregate-operations.test.ts | 10 | 6 | 0 | 4 |
| view-operations.test.ts | 10 | 6 | 0 | 4 |
| materialized-view-operations.test.ts | 9 | 6 | 0 | 3 |
| index-operations.test.ts | 12 | 6 | 2 | 4 |
| index-extension-deps.test.ts | 3 | 3 | 0 | 0 |
| **Total** | **67** | **39** | **3** | **25** |

39 corpus directories created.
