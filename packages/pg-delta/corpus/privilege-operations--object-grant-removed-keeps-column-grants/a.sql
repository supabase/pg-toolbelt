-- state A: one role holds an object-level grant AND a column grant on a table,
-- a view and a materialized view
DO $$ BEGIN CREATE ROLE corpus_colgrant_removed NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.t (id integer, name text);
GRANT SELECT ON test_schema.t TO corpus_colgrant_removed;
GRANT UPDATE (name) ON test_schema.t TO corpus_colgrant_removed;

CREATE VIEW test_schema.v AS SELECT 1 AS a, 2 AS b;
GRANT SELECT ON test_schema.v TO corpus_colgrant_removed;
GRANT UPDATE (b) ON test_schema.v TO corpus_colgrant_removed;

CREATE MATERIALIZED VIEW test_schema.mv AS SELECT 1 AS a, 2 AS b;
GRANT SELECT ON test_schema.mv TO corpus_colgrant_removed;
GRANT REFERENCES (b) ON test_schema.mv TO corpus_colgrant_removed;
