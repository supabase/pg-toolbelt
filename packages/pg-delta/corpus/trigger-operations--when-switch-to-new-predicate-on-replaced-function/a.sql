CREATE SCHEMA test_schema;
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
CREATE FUNCTION test_schema.check_value(x integer)
RETURNS integer LANGUAGE sql IMMUTABLE
RETURN x;
CREATE FUNCTION test_schema.old_predicate()
RETURNS boolean LANGUAGE sql
BEGIN ATOMIC
  SELECT test_schema.check_value(1) > 0;
END;
CREATE TRIGGER items_touch BEFORE UPDATE ON test_schema.items
  FOR EACH ROW WHEN (test_schema.old_predicate())
  EXECUTE FUNCTION test_schema.touch();
