-- The text Postgres settles on for b.sql's check.
CREATE SCHEMA s;

CREATE TABLE s.t1 (a int, b int,
  CONSTRAINT ck CHECK ((b >= 0) AND (b <= 10) AND (a >= 0)));
