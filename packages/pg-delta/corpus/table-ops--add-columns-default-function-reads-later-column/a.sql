-- Same shape as table-ops--default-function-reads-later-column, on an existing
-- populated table: adding `a` evaluates app.f(), which reads `b`, so `b` must
-- be added first.
CREATE SCHEMA app;

CREATE FUNCTION app.f()
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
AS $function$ begin return (select count(b) from app.t); end $function$;

CREATE TABLE app.t (
  id integer
);
