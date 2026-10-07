-- Parameter defaults are deparsed into the routine's header (its argument
-- signature and definition) even when the body is a string. A BETWEEN or a row
-- comparison on the left of the same AND/OR prints nested on its first parse
-- and flat after a replay; an argument-signature change replaces the routine
-- and its dependents, so neither direction may plan anything.
CREATE SCHEMA s;

CREATE FUNCTION s.fs(a int, b boolean DEFAULT (1 BETWEEN 0 AND 2 AND true))
  RETURNS int LANGUAGE sql AS $$ SELECT a $$;

CREATE FUNCTION s.fa(a int, b boolean DEFAULT ((1, 2) IS DISTINCT FROM (1, 3) OR false))
  RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT a; END;

CREATE PROCEDURE s.p(a int, b boolean DEFAULT (1 BETWEEN 0 AND 2 AND true))
  LANGUAGE sql AS $$ SELECT a $$;

CREATE VIEW s.v AS SELECT s.fs(1) AS x, s.fa(1) AS y;
