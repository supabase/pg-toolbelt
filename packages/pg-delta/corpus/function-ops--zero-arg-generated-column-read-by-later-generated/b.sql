-- g calls app.one() and reads no column. x reads id and calls app.h(), which
-- reads g; Postgres folds app.h() when x is added, so x must still wait on g
-- even though g no longer leads the column chain (#554).
CREATE SCHEMA app;

CREATE FUNCTION app.one()
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$ select 1 $function$;

CREATE FUNCTION app.h()
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$ begin return (select coalesce(max(g), 0) from app.orders); end $function$;

CREATE TABLE app.orders (
  id integer,
  g integer GENERATED ALWAYS AS (app.one()) STORED,
  x integer GENERATED ALWAYS AS (id + app.h()) STORED,
  b integer
);
