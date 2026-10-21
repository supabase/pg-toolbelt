-- A DEFAULT whose function reads a column declared AFTER it (PR #553 review).
--
-- PostgreSQL evaluates a non-volatile DEFAULT once at ADD COLUMN time, even on
-- an empty table, so `a` can only be added once `b` exists. The plpgsql body
-- records no pg_depend edge to `b`, so the engine cannot see that dependency:
-- the evaluator stratum (#392) must keep `a` after `b`, and chaining a table's
-- column creates by declared position (#518) must not override it.
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
