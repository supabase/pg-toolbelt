CREATE SCHEMA test_schema;
CREATE TYPE test_schema.state AS ENUM ('a');
CREATE TABLE test_schema.items (
  id serial PRIMARY KEY,
  name text
);
CREATE FUNCTION test_schema.touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RETURN NEW;
END;
$$;
CREATE FUNCTION test_schema.old_ok(s test_schema.state)
RETURNS boolean LANGUAGE sql IMMUTABLE
RETURN s IS NOT NULL;
CREATE TRIGGER items_touch BEFORE UPDATE ON test_schema.items
  FOR EACH ROW WHEN (test_schema.old_ok('a'::test_schema.state))
  EXECUTE FUNCTION test_schema.touch();
