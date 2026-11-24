-- the same expression as a PG 18 VIRTUAL generated column (#606). PG 18 has no
-- ALTER between STORED and VIRTUAL, so the column is replaced, never the table.
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.calculations (
  id integer NOT NULL,
  value numeric NOT NULL,
  doubled numeric GENERATED ALWAYS AS (value * 2) VIRTUAL
);
