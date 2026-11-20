-- Each column gains NOT NULL with a new or changed default. mood's default
-- casts to a new enum, so it must follow CREATE TYPE. label and code default
-- to new BEGIN ATOMIC functions that read the column, so SET NOT NULL must
-- precede the function and SET DEFAULT must follow it.
CREATE SCHEMA app;

CREATE TYPE app.mood AS ENUM ('calm', 'busy');

CREATE TABLE app.t (
  id integer NOT NULL,
  status text NOT NULL DEFAULT 'new',
  note text NOT NULL DEFAULT 'new',
  mood text NOT NULL DEFAULT 'calm'::app.mood,
  label text,
  code text
);

CREATE FUNCTION app.last_label() RETURNS text
LANGUAGE sql
BEGIN ATOMIC
  SELECT max(label) FROM app.t;
END;

CREATE FUNCTION app.last_code() RETURNS text
LANGUAGE sql
BEGIN ATOMIC
  SELECT max(code) FROM app.t;
END;

ALTER TABLE app.t
  ALTER COLUMN label SET NOT NULL,
  ALTER COLUMN label SET DEFAULT app.last_label(),
  ALTER COLUMN code SET NOT NULL,
  ALTER COLUMN code SET DEFAULT app.last_code();
