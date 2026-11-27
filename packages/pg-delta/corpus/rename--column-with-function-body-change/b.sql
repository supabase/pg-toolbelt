CREATE FUNCTION f(x integer) RETURNS integer LANGUAGE sql IMMUTABLE AS $f$SELECT x + 1$f$;
CREATE TABLE t (id int, c_r int DEFAULT f(1));
