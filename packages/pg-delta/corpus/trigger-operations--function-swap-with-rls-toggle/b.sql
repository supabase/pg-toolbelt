CREATE SCHEMA test_schema;

-- the trigger's own table changes in the same plan (row level security is
-- switched on) while the trigger moves to touch_v2 and touch_v1 is dropped.
-- Nothing touch_v1 depends on changes, so the trigger still alters in place.
CREATE TABLE test_schema.items (
  id serial PRIMARY KEY,
  name text
);

ALTER TABLE test_schema.items ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION test_schema.touch_v2()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RETURN NEW;
END;
$$;

CREATE TRIGGER items_touch BEFORE INSERT ON test_schema.items
  FOR EACH ROW EXECUTE FUNCTION test_schema.touch_v2();
