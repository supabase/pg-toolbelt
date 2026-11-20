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
  name text,
  retries integer DEFAULT test_schema.read_setting()
);

CREATE FUNCTION test_schema.has_retries()
RETURNS boolean LANGUAGE sql
BEGIN ATOMIC
  SELECT EXISTS (SELECT 1 FROM test_schema.jobs WHERE retries > 0);
END;

-- The trigger moves to guard_setting and protect_setting is dropped. Its new
-- WHEN reads jobs.retries, so the trigger change has to wait for that column,
-- whose DEFAULT backfill updates settings. Altered in place, the old trigger
-- would still be there to fire on that update and raise. Dropped first, as
-- before, nothing fires.
CREATE FUNCTION test_schema.guard_setting()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect BEFORE UPDATE ON test_schema.settings
  FOR EACH ROW WHEN (test_schema.has_retries())
  EXECUTE FUNCTION test_schema.guard_setting();
