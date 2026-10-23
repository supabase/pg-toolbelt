-- s.gone has s.t1's shape but another bound, so it near-misses s.t2 too.
CREATE SCHEMA s;

CREATE TABLE s.t1 (a int, b int,
  CONSTRAINT ck CHECK ((b >= 0) AND (b <= 10) AND (a >= 0)));
CREATE TABLE s.gone (a int, b int,
  CONSTRAINT ck CHECK ((b >= 0) AND (b <= 9) AND (a >= 0)));
