-- state B: the view drops `id` and gains `note`; the surviving `name` grant is re-granted
DO $$ BEGIN CREATE ROLE corpus_r_view_col_replace NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA test_schema;
CREATE TABLE test_schema.items (id integer, name text, note text);
CREATE VIEW test_schema.v_items AS
  SELECT name, note FROM test_schema.items;
GRANT INSERT (name), SELECT (note) ON test_schema.v_items TO corpus_r_view_col_replace;
