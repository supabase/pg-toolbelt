-- a STORED generated column (base state)
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.calculations (
  id integer NOT NULL,
  value numeric NOT NULL,
  doubled numeric GENERATED ALWAYS AS (value * 2) STORED
);
