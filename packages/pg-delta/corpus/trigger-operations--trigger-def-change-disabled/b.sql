CREATE SCHEMA test_schema;

CREATE FUNCTION test_schema.default_label()
RETURNS text LANGUAGE sql AS $$ SELECT 'unlabeled' $$;

CREATE FUNCTION test_schema.audit_item()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RETURN NEW;
END;
$$;

-- `label`'s DEFAULT calls a routine, so its ADD COLUMN sorts in the evaluator
-- stratum; the changed trigger's UPDATE OF label must still run after it.
CREATE TABLE test_schema.items (
  id serial PRIMARY KEY,
  label text DEFAULT test_schema.default_label()
);

CREATE TRIGGER items_audit
  BEFORE INSERT OR UPDATE OF label ON test_schema.items
  FOR EACH ROW
  EXECUTE FUNCTION test_schema.audit_item();

ALTER TABLE test_schema.items DISABLE TRIGGER items_audit;

COMMENT ON TRIGGER items_audit ON test_schema.items IS 'audits item writes';
