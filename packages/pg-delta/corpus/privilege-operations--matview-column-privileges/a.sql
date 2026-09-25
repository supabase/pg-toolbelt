-- state A: object-level SELECT on a materialized view
DO $$ BEGIN CREATE ROLE corpus_r_matview_col NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA test_schema;
CREATE MATERIALIZED VIEW test_schema.mv_priv AS SELECT 1 AS a, 2 AS b;
GRANT SELECT ON test_schema.mv_priv TO corpus_r_matview_col;
