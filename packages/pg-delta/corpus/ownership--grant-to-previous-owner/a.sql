-- state A: the function is owned by another role
CREATE ROLE corpus_prev_owner NOLOGIN;
CREATE FUNCTION f() RETURNS integer LANGUAGE sql AS 'SELECT 0';
ALTER FUNCTION f() OWNER TO corpus_prev_owner;
