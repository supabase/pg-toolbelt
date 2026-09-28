-- state A: a view with column grants on both of its columns
-- Guards the re-grant after a view rebuild through the proof loop's state
-- comparison. The budget cannot single out column acls (the owner's acl is
-- re-created on every replace), so the extraction regression itself is pinned
-- by tests/view-column-grant-fidelity.test.ts.
DO $$ BEGIN CREATE ROLE corpus_r_view_col_replace NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA test_schema;
CREATE TABLE test_schema.items (id integer, name text, note text);
CREATE VIEW test_schema.v_items AS
  SELECT id, name FROM test_schema.items;
GRANT SELECT (id), INSERT (name) ON test_schema.v_items TO corpus_r_view_col_replace;
