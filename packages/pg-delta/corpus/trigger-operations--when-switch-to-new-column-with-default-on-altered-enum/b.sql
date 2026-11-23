CREATE SCHEMA test_schema;
CREATE TYPE test_schema.state AS ENUM ('a', 'b');
CREATE FUNCTION test_schema.new_value(s test_schema.state)
RETURNS integer LANGUAGE sql IMMUTABLE
RETURN 1;
-- old_ok is dropped and the new WHEN reads new_col. new_col itself is new and
-- unremarkable, but its DEFAULT (added in the same ADD COLUMN) calls a new
-- function on an enum this plan alters, and that alter waits on old_ok's drop
CREATE TABLE test_schema.items (
  id serial PRIMARY KEY,
  name text,
  new_col integer DEFAULT test_schema.new_value('a'::test_schema.state)
);
CREATE FUNCTION test_schema.touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RETURN NEW;
END;
$$;
CREATE TRIGGER items_touch BEFORE UPDATE ON test_schema.items
  FOR EACH ROW WHEN (NEW.new_col > 0)
  EXECUTE FUNCTION test_schema.touch();
