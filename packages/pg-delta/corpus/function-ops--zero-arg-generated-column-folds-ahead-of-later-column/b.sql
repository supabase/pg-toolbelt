-- Same column g as function-ops--zero-arg-generated-column-reads-later-column,
-- but app.f() already exists and b waits on an enum the plan creates. g must
-- not fold into CREATE TABLE ahead of b: Postgres would run app.f() there,
-- before b exists (#554).
CREATE SCHEMA app;

CREATE FUNCTION app.f()
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$ begin return (select count(b) from app.t); end $function$;

CREATE TYPE app.mood AS ENUM ('a');

CREATE TABLE app.t (
  id integer,
  g integer GENERATED ALWAYS AS (app.f()) STORED,
  b app.mood
);
