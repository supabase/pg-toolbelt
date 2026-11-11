-- The text Postgres settles on for b.sql's checks.
CREATE SCHEMA s;

CREATE TABLE s.t1 (id int PRIMARY KEY, a int, b int,
  CHECK ((a >= 0) AND (a <= 5) AND (id >= 0)),
  CHECK ((b >= 0) AND (b <= 5) AND (id >= 0)));
