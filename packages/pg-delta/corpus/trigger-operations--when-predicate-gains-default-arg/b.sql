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
-- the new overload reuses the dropped function's name: while both exist,
-- is_pos(NEW.qty) is ambiguous, so the trigger cannot be replaced in place
-- before the old overload is dropped
CREATE FUNCTION test_schema.is_pos(x integer, label text DEFAULT 'd')
RETURNS boolean LANGUAGE sql IMMUTABLE
RETURN x > 0;
CREATE TRIGGER items_touch BEFORE INSERT ON test_schema.items
  FOR EACH ROW WHEN (test_schema.is_pos(NEW.qty) AND NEW.qty < 100)
  EXECUTE FUNCTION test_schema.touch();
