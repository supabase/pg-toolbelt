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
-- the trigger moves to a NEW predicate that calls check_value, whose return
-- type changes (drop + create) while old_predicate (also calling it) is
-- dropped: the replaced function is a transitive dependency of the new WHEN
CREATE FUNCTION test_schema.check_value(x integer)
RETURNS boolean LANGUAGE sql IMMUTABLE
RETURN x > 0;
CREATE FUNCTION test_schema.new_predicate()
RETURNS boolean LANGUAGE sql
BEGIN ATOMIC
  SELECT test_schema.check_value(1);
END;
CREATE TRIGGER items_touch BEFORE UPDATE ON test_schema.items
  FOR EACH ROW WHEN (test_schema.new_predicate())
  EXECUTE FUNCTION test_schema.touch();
