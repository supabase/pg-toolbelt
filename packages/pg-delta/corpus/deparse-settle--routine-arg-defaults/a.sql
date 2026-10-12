-- The text Postgres settles on for b.sql's parameter defaults.
CREATE SCHEMA s;

CREATE FUNCTION s.fs(a int, b boolean DEFAULT ((1 >= 0) AND (1 <= 2) AND true))
  RETURNS int LANGUAGE sql AS $$ SELECT a $$;

CREATE FUNCTION s.fa(a int, b boolean DEFAULT ((1 IS DISTINCT FROM 1) OR (2 IS DISTINCT FROM 3) OR false))
  RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT a; END;

CREATE PROCEDURE s.p(a int, b boolean DEFAULT ((1 >= 0) AND (1 <= 2) AND true))
  LANGUAGE sql AS $$ SELECT a $$;

CREATE VIEW s.v AS SELECT s.fs(1) AS x, s.fa(1) AS y;
