-- state B: only the object-level privilege set changes; the column grants are
-- untouched. The object-level acl replace leads with `REVOKE ALL ON <rel> FROM
-- <role>`, which also revokes the role's column privileges — the plan must
-- re-grant them afterwards (in both directions).
DO $$ BEGIN CREATE ROLE corpus_colgrant_change NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.t (id integer, name text);
GRANT SELECT, DELETE, INSERT ON test_schema.t TO corpus_colgrant_change;
GRANT UPDATE (name) ON test_schema.t TO corpus_colgrant_change;

CREATE VIEW test_schema.v AS SELECT 1 AS a, 2 AS b;
GRANT SELECT, INSERT ON test_schema.v TO corpus_colgrant_change;
GRANT UPDATE (b) ON test_schema.v TO corpus_colgrant_change;

CREATE MATERIALIZED VIEW test_schema.mv AS SELECT 1 AS a, 2 AS b;
GRANT SELECT, TRIGGER ON test_schema.mv TO corpus_colgrant_change;
GRANT REFERENCES (b) ON test_schema.mv TO corpus_colgrant_change;
