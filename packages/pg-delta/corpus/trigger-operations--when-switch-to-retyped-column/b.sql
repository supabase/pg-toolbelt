CREATE SCHEMA test_schema;
CREATE TABLE test_schema.items (
  id serial PRIMARY KEY,
  qty numeric
);
CREATE FUNCTION test_schema.touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RETURN NEW;
END;
$$;
-- old_predicate is dropped and the new WHEN reads qty, which is retyped in
-- the same plan: the trigger must be rebuilt around ALTER COLUMN TYPE, not
-- altered before the old_predicate drop
CREATE TRIGGER items_touch BEFORE UPDATE ON test_schema.items
  FOR EACH ROW WHEN (NEW.qty > 0)
  EXECUTE FUNCTION test_schema.touch();
