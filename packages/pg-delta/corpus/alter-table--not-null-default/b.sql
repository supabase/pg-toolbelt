-- Each column gains NOT NULL with a new or changed default. mood's default
-- casts to a new enum, so it must follow CREATE TYPE.
CREATE SCHEMA app;

CREATE TYPE app.mood AS ENUM ('calm', 'busy');

CREATE TABLE app.t (
  id integer NOT NULL,
  status text NOT NULL DEFAULT 'new',
  note text NOT NULL DEFAULT 'new',
  mood text NOT NULL DEFAULT 'calm'::app.mood
);
