-- state A: default privileges grant ALL ON TABLES to a role that holds ONLY a
-- column grant on a view (the object-level default was revoked)
DO $$ BEGIN CREATE ROLE corpus_r_view_adp_col NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA test_schema;
ALTER DEFAULT PRIVILEGES IN SCHEMA test_schema GRANT ALL ON TABLES TO corpus_r_view_adp_col;
CREATE VIEW test_schema.v AS SELECT 1 AS a, 2 AS b;
REVOKE ALL ON test_schema.v FROM corpus_r_view_adp_col;
GRANT UPDATE (b) ON test_schema.v TO corpus_r_view_adp_col;
