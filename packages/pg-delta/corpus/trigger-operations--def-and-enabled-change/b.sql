CREATE SCHEMA test_schema;
CREATE TABLE test_schema.items (
  id serial PRIMARY KEY,
  name text,
  note text
);
CREATE FUNCTION test_schema.touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RETURN NEW;
END;
$$;
CREATE TRIGGER items_touch BEFORE INSERT OR UPDATE ON test_schema.items
  FOR EACH ROW WHEN (NEW.name IS NOT NULL) EXECUTE FUNCTION test_schema.touch();
ALTER TABLE test_schema.items ENABLE REPLICA TRIGGER items_touch;
