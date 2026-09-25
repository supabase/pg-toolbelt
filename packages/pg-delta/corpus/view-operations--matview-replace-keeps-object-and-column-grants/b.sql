-- state B: the materialized view definition changes (drop + recreate); both
-- grants are unchanged and must be re-granted, the column grant after the
-- object-level one
DO $$ BEGIN CREATE ROLE corpus_r_mv_objcol NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA test_schema;
CREATE MATERIALIZED VIEW test_schema.mv AS SELECT 10 AS a, 20 AS b;
GRANT SELECT ON test_schema.mv TO corpus_r_mv_objcol;
GRANT REFERENCES (b) ON test_schema.mv TO corpus_r_mv_objcol;
