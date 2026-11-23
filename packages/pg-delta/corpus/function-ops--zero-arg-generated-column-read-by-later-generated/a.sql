CREATE SCHEMA app;

CREATE FUNCTION app.h()
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$ begin return (select coalesce(max(g), 0) from app.orders); end $function$;
