-- The text Postgres settles on after replaying b.sql's definitions twice.
CREATE SCHEMA s;

CREATE TABLE s.t (
  a int,
  b int,
  c int,
  d int,
  e int,
  CONSTRAINT ck CHECK (
    (a IS DISTINCT FROM 1) OR (b IS DISTINCT FROM 2)
    OR ((c IS DISTINCT FROM 3) OR (d IS DISTINCT FROM 4))
    OR (e IS DISTINCT FROM 5)
  )
);

CREATE VIEW s.v AS SELECT a FROM s.t
  WHERE (a IS DISTINCT FROM 1) OR (b IS DISTINCT FROM 2)
    OR ((c IS DISTINCT FROM 3) OR (d IS DISTINCT FROM 4))
    OR (e IS DISTINCT FROM 5);
