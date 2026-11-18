CREATE SCHEMA test_schema;
CREATE TABLE test_schema.items (
  id serial PRIMARY KEY,
  qty integer
);
CREATE FUNCTION test_schema.touch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN NEW;
END;
$$;
CREATE TRIGGER items_when_qty
BEFORE UPDATE ON test_schema.items
FOR EACH ROW
WHEN (new.qty > 0)
EXECUTE FUNCTION test_schema.touch();
CREATE TRIGGER items_update_of_qty
BEFORE UPDATE OF qty ON test_schema.items
FOR EACH ROW
EXECUTE FUNCTION test_schema.touch();
