CREATE SCHEMA test_schema;
CREATE TABLE test_schema.items (
  id serial PRIMARY KEY,
  note text
);
CREATE FUNCTION test_schema.touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RETURN NEW;
END;
$$;
CREATE TRIGGER items_touch BEFORE UPDATE OF note ON test_schema.items
  FOR EACH ROW EXECUTE FUNCTION test_schema.touch();
