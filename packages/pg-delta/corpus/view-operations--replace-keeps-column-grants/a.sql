-- state A: a view with column grants on both of its columns
DO $$ BEGIN CREATE ROLE corpus_r_view_col_replace NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA test_schema;
CREATE TABLE test_schema.items (id integer, name text, note text);
CREATE VIEW test_schema.v_items AS
  SELECT id, name FROM test_schema.items;
GRANT SELECT (id), INSERT (name) ON test_schema.v_items TO corpus_r_view_col_replace;
