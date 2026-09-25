-- state B: relations created under the default privileges, then narrowed per
-- role: corpus_colgrant_adp keeps an object-level grant PLUS a column grant,
-- corpus_colgrant_adp_colonly keeps ONLY a column grant. The create-time
-- `REVOKE ALL ON <rel> FROM <role>` (explicit or hygiene) also revokes that
-- role's column privileges, so every column GRANT must run after it.
DO $$ BEGIN CREATE ROLE corpus_colgrant_adp NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE corpus_colgrant_adp_colonly NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA test_schema;
ALTER DEFAULT PRIVILEGES IN SCHEMA test_schema
  GRANT ALL ON TABLES TO corpus_colgrant_adp, corpus_colgrant_adp_colonly;

CREATE TABLE test_schema.t (id integer, name text);
REVOKE ALL ON test_schema.t FROM corpus_colgrant_adp, corpus_colgrant_adp_colonly;
GRANT SELECT ON test_schema.t TO corpus_colgrant_adp;
GRANT UPDATE (name) ON test_schema.t TO corpus_colgrant_adp;
GRANT SELECT (id) ON test_schema.t TO corpus_colgrant_adp_colonly;

CREATE VIEW test_schema.v AS SELECT 1 AS a, 2 AS b;
REVOKE ALL ON test_schema.v FROM corpus_colgrant_adp, corpus_colgrant_adp_colonly;
GRANT SELECT ON test_schema.v TO corpus_colgrant_adp;
GRANT UPDATE (b) ON test_schema.v TO corpus_colgrant_adp;
GRANT SELECT (a) ON test_schema.v TO corpus_colgrant_adp_colonly;

CREATE MATERIALIZED VIEW test_schema.mv AS SELECT 1 AS a, 2 AS b;
REVOKE ALL ON test_schema.mv FROM corpus_colgrant_adp, corpus_colgrant_adp_colonly;
GRANT SELECT ON test_schema.mv TO corpus_colgrant_adp;
GRANT REFERENCES (b) ON test_schema.mv TO corpus_colgrant_adp;
GRANT SELECT (a) ON test_schema.mv TO corpus_colgrant_adp_colonly;
