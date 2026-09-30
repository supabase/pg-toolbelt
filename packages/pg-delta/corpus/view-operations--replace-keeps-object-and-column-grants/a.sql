-- state A: a view on which one role holds an object-level grant AND a column grant
DO $$ BEGIN CREATE ROLE corpus_r_view_objcol NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA test_schema;
CREATE VIEW test_schema.v AS SELECT 1 AS a, 2 AS b;
GRANT SELECT ON test_schema.v TO corpus_r_view_objcol;
GRANT UPDATE (b) ON test_schema.v TO corpus_r_view_objcol;
