CREATE SCHEMA test_schema;

CREATE TABLE test_schema.settings (
  id integer PRIMARY KEY,
  value integer
);

-- writes to settings each time it is evaluated
CREATE FUNCTION test_schema.read_setting()
RETURNS integer LANGUAGE sql VOLATILE AS $$
  UPDATE test_schema.settings SET value = value WHERE id = 1 RETURNING value
$$;

CREATE TABLE test_schema.jobs (
  id serial PRIMARY KEY,
  name text
);

CREATE FUNCTION test_schema.protect_setting()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.id = 1 THEN
    RAISE EXCEPTION 'protected setting';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect BEFORE UPDATE ON test_schema.settings
  FOR EACH ROW EXECUTE FUNCTION test_schema.protect_setting();
