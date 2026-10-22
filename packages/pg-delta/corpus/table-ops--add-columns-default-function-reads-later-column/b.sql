CREATE SCHEMA app;

CREATE FUNCTION app.f()
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
AS $function$ begin return (select count(b) from app.t); end $function$;

CREATE TABLE app.t (
  id integer,
  a integer DEFAULT app.f(),
  b integer
);
