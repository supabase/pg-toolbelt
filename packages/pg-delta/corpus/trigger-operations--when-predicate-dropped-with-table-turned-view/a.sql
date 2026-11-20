CREATE SCHEMA test_schema;
CREATE TABLE test_schema.helper (
  on_ boolean DEFAULT true
);
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
CREATE FUNCTION test_schema.old_pred()
RETURNS boolean LANGUAGE sql
BEGIN ATOMIC
  SELECT EXISTS (SELECT 1 FROM test_schema.helper WHERE on_);
END;
CREATE TRIGGER items_touch BEFORE UPDATE ON test_schema.items
  FOR EACH ROW WHEN (test_schema.old_pred())
  EXECUTE FUNCTION test_schema.touch();
