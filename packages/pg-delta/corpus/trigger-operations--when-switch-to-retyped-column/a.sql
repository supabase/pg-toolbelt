CREATE SCHEMA test_schema;
CREATE TABLE test_schema.items (
  id serial PRIMARY KEY,
  qty integer
);
CREATE FUNCTION test_schema.touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RETURN NEW;
END;
$$;
CREATE FUNCTION test_schema.old_predicate()
RETURNS boolean LANGUAGE sql
BEGIN ATOMIC
  SELECT true;
END;
CREATE TRIGGER items_touch BEFORE UPDATE ON test_schema.items
  FOR EACH ROW WHEN (test_schema.old_predicate())
  EXECUTE FUNCTION test_schema.touch();
