CREATE SCHEMA test_schema;
-- old_pred read the helper TABLE, which becomes a same-name VIEW. Releasing
-- old_pred through the trigger's alter delays its drop, and with it the
-- DROP TABLE helper that must run before CREATE VIEW helper
CREATE VIEW test_schema.helper AS SELECT true AS on_;
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
CREATE TRIGGER items_touch BEFORE UPDATE ON test_schema.items
  FOR EACH ROW EXECUTE FUNCTION test_schema.touch();
