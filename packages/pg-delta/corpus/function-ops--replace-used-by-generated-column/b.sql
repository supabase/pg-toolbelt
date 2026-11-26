CREATE FUNCTION f(x integer) RETURNS bigint LANGUAGE sql IMMUTABLE AS $f$SELECT (x + 1)::bigint$f$;
CREATE TABLE t (id int, c bigint GENERATED ALWAYS AS (f(id)) STORED);
