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
-- check_value's return type changes (drop + create), old_predicate (which
-- calls it) is dropped, and the new WHEN calls check_value directly: altering
-- the trigger before the old_predicate drop would need check_value's
-- re-create first, which itself waits on that drop
CREATE FUNCTION test_schema.check_value(x integer)
RETURNS boolean LANGUAGE sql IMMUTABLE
RETURN x > 0;
CREATE TRIGGER items_touch BEFORE UPDATE ON test_schema.items
  FOR EACH ROW WHEN (test_schema.check_value(1))
  EXECUTE FUNCTION test_schema.touch();
