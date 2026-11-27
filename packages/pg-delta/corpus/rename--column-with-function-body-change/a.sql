CREATE FUNCTION f(x integer) RETURNS integer LANGUAGE sql IMMUTABLE AS $f$SELECT x$f$;
CREATE TABLE t (id int, c int DEFAULT f(1));
