DO $$ BEGIN CREATE ROLE corpus_trigger_swap_owner; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA test_schema;
-- the schema's owner changes in the same plan: touch_v1's drop goes before
-- that alter and touch_v2's create after it, so the trigger cannot move to
-- touch_v2 before touch_v1 is dropped
ALTER SCHEMA test_schema OWNER TO corpus_trigger_swap_owner;
CREATE TABLE test_schema.items (
  id serial PRIMARY KEY,
  name text
);
CREATE FUNCTION test_schema.touch_v2()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RETURN NEW;
END;
$$;
CREATE TRIGGER items_touch BEFORE INSERT ON test_schema.items
  FOR EACH ROW EXECUTE FUNCTION test_schema.touch_v2();
