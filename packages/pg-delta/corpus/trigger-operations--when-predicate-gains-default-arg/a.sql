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
CREATE FUNCTION test_schema.is_pos(x integer)
RETURNS boolean LANGUAGE sql IMMUTABLE
RETURN x > 0;
CREATE TRIGGER items_touch BEFORE INSERT ON test_schema.items
  FOR EACH ROW WHEN (test_schema.is_pos(NEW.qty))
  EXECUTE FUNCTION test_schema.touch();
