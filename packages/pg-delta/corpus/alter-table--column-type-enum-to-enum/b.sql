-- columns retyped to a DIFFERENTLY named enum: PostgreSQL has no enum-to-enum
-- cast, so the retype must go through text (text[] for the array column)
CREATE SCHEMA test_schema;

CREATE TYPE test_schema.widget_status AS ENUM ('draft', 'active');

CREATE TABLE test_schema.widgets (
  id integer PRIMARY KEY,
  status test_schema.widget_status NOT NULL,
  history test_schema.widget_status[]
);
