-- g calls app.one() and reads no column, and x's DEFAULT calls app.h(), which
-- reads g. Postgres runs app.h() when x is added, so x must be added after g
-- (#554).
CREATE SCHEMA app;

CREATE FUNCTION app.one()
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$ select 1 $function$;

CREATE FUNCTION app.h()
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
AS $function$ begin return (select coalesce(max(g), 0) from app.t); end $function$;

CREATE TABLE app.t (
  id integer,
  g integer GENERATED ALWAYS AS (app.one()) STORED,
  x integer DEFAULT app.h()
);
