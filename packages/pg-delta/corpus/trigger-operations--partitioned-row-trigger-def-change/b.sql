CREATE SCHEMA test_schema;
CREATE FUNCTION test_schema.audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END; $$;
CREATE TABLE test_schema.events (id integer NOT NULL) PARTITION BY RANGE (id);
CREATE TABLE test_schema.events_p0 PARTITION OF test_schema.events FOR VALUES FROM (0) TO (1000);
CREATE TRIGGER events_audit AFTER INSERT OR UPDATE ON test_schema.events
  FOR EACH ROW EXECUTE FUNCTION test_schema.audit();
