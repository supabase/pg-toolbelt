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
-- the same plan. old_predicate depends on nothing that changes, so the
-- trigger alters in place: after ALTER COLUMN TYPE, before the drop
CREATE TRIGGER items_touch BEFORE UPDATE ON test_schema.items
  FOR EACH ROW WHEN (NEW.qty > 0)
  EXECUTE FUNCTION test_schema.touch();
