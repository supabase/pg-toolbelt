-- state B: the object-level grant is gone; the column grants are unchanged.
-- Forward, the object-level `REVOKE ALL ON <rel> FROM <role>` also revokes the
-- column privileges, so they must be re-granted after it. Reverse, the added
-- object-level grant leads with the same REVOKE ALL on a pre-existing relation.
DO $$ BEGIN CREATE ROLE corpus_colgrant_removed NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.t (id integer, name text);
GRANT UPDATE (name) ON test_schema.t TO corpus_colgrant_removed;

CREATE VIEW test_schema.v AS SELECT 1 AS a, 2 AS b;
GRANT UPDATE (b) ON test_schema.v TO corpus_colgrant_removed;

CREATE MATERIALIZED VIEW test_schema.mv AS SELECT 1 AS a, 2 AS b;
GRANT REFERENCES (b) ON test_schema.mv TO corpus_colgrant_removed;
