-- columns typed with enum `status` (scalar and array)
CREATE SCHEMA test_schema;

CREATE TYPE test_schema.status AS ENUM ('draft', 'active', 'retired', 'archived');

CREATE TABLE test_schema.widgets (
  id integer PRIMARY KEY,
  status test_schema.status NOT NULL,
  history test_schema.status[]
);
