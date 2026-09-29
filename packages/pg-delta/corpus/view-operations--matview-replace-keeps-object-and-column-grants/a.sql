-- state A: a materialized view on which one role holds an object-level grant
-- AND a column grant
DO $$ BEGIN CREATE ROLE corpus_r_mv_objcol NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA test_schema;
CREATE MATERIALIZED VIEW test_schema.mv AS SELECT 1 AS a, 2 AS b;
GRANT SELECT ON test_schema.mv TO corpus_r_mv_objcol;
GRANT REFERENCES (b) ON test_schema.mv TO corpus_r_mv_objcol;
