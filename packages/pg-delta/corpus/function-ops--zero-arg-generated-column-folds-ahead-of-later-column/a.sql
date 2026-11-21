CREATE SCHEMA app;

CREATE FUNCTION app.f()
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$ begin return (select count(b) from app.t); end $function$;
