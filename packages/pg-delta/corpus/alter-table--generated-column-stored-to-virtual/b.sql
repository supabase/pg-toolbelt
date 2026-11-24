-- the same expression as a PG 18 VIRTUAL generated column (#606). PG 18 has no
-- ALTER between STORED and VIRTUAL, so the column is replaced, never the table.
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.calculations (
  id integer NOT NULL,
  value numeric NOT NULL,
  doubled numeric GENERATED ALWAYS AS (value * 2) VIRTUAL
);

-- an INHERITS child that redeclares the generated column with its own
-- expression, in both name orders: the parent's column drops first and is
-- added last, so the child's definition merges back.
CREATE TABLE test_schema.z_parent (
  n integer,
  scaled integer GENERATED ALWAYS AS (n * 2) VIRTUAL
);

CREATE TABLE test_schema.a_child (
  scaled integer GENERATED ALWAYS AS (n * 3) VIRTUAL
) INHERITS (test_schema.z_parent);

CREATE TABLE test_schema.a_parent (
  n integer,
  scaled integer GENERATED ALWAYS AS (n * 2) VIRTUAL
);

CREATE TABLE test_schema.z_child (
  scaled integer GENERATED ALWAYS AS (n * 3) VIRTUAL
) INHERITS (test_schema.a_parent);

-- the same replace while the other side adds a redeclaring child: the new
-- child's column is added before the parent's.
CREATE TABLE test_schema.b_parent (
  n integer,
  scaled integer GENERATED ALWAYS AS (n * 2) VIRTUAL
);

CREATE TABLE test_schema.y_new_child (
  scaled integer GENERATED ALWAYS AS (n * 3) VIRTUAL
) INHERITS (test_schema.b_parent);

-- a partitioned table whose partition keeps the parent's expression: the
-- parent's column is replaced and the partition follows.
CREATE TABLE test_schema.readings (
  n integer,
  scaled integer GENERATED ALWAYS AS (n * 2) VIRTUAL
) PARTITION BY RANGE (n);

CREATE TABLE test_schema.readings_low PARTITION OF test_schema.readings
  FOR VALUES FROM (0) TO (100);
