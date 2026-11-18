CREATE SCHEMA test_schema;
CREATE TABLE test_schema.items (
  id serial PRIMARY KEY,
  name text
);
CREATE FUNCTION test_schema.touch_v2()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.name := coalesce(NEW.name, 'unnamed');
  RETURN NEW;
END;
$$;
CREATE TRIGGER items_touch BEFORE INSERT ON test_schema.items
  FOR EACH ROW EXECUTE FUNCTION test_schema.touch_v2();
