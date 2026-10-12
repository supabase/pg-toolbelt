-- The flat spelling Postgres settles on: semantically identical to b.sql.
CREATE SCHEMA s;

CREATE TABLE s.t (a int, b int, c int);

CREATE PUBLICATION pb FOR TABLE s.t
  WHERE ((a IS DISTINCT FROM 1) OR (b IS DISTINCT FROM 2) OR (c IS DISTINCT FROM 3))
  WITH (publish = 'insert');
