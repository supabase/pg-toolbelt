-- g calls app.f() and reads no column of its own table, so Postgres runs
-- app.f() when g is added, even on the new empty table. The body reads b,
-- declared after g, with no pg_depend edge to it, so g must be added after
-- b (#554).
CREATE SCHEMA app;

CREATE FUNCTION app.f()
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$ begin return (select count(b) from app.t); end $function$;

CREATE TABLE app.t (
  id integer,
  g integer GENERATED ALWAYS AS (app.f()) STORED,
  b integer
);
