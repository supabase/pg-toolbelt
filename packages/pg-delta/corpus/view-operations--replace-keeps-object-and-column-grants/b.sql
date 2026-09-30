-- state B: the view definition changes (drop + recreate); both grants are
-- unchanged and must be re-granted, the column grant after the object-level one
DO $$ BEGIN CREATE ROLE corpus_r_view_objcol NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA test_schema;
CREATE VIEW test_schema.v AS SELECT 10 AS a, 20 AS b;
GRANT SELECT ON test_schema.v TO corpus_r_view_objcol;
GRANT UPDATE (b) ON test_schema.v TO corpus_r_view_objcol;
