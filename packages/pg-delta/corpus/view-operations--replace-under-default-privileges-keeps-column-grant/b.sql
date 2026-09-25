-- state B: the view definition changes (drop + recreate). The recreate fires
-- the default privileges again, so the hygiene `REVOKE ALL ON v FROM role`
-- runs — and the unchanged column grant must be re-granted after it.
DO $$ BEGIN CREATE ROLE corpus_r_view_adp_col NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA test_schema;
ALTER DEFAULT PRIVILEGES IN SCHEMA test_schema GRANT ALL ON TABLES TO corpus_r_view_adp_col;
CREATE VIEW test_schema.v AS SELECT 10 AS a, 20 AS b;
REVOKE ALL ON test_schema.v FROM corpus_r_view_adp_col;
GRANT UPDATE (b) ON test_schema.v TO corpus_r_view_adp_col;
