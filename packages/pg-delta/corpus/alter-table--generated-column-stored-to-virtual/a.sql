-- a STORED generated column (base state)
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.calculations (
  id integer NOT NULL,
  value numeric NOT NULL,
  doubled numeric GENERATED ALWAYS AS (value * 2) STORED
);

-- a partitioned table whose partition keeps the parent's expression: the
-- parent's column is replaced and the partition follows.
CREATE TABLE test_schema.readings (
  n integer,
  scaled integer GENERATED ALWAYS AS (n * 2) STORED
) PARTITION BY RANGE (n);

CREATE TABLE test_schema.readings_low PARTITION OF test_schema.readings
  FOR VALUES FROM (0) TO (100);
