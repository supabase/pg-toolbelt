-- s.gone pairs with s.t2 too and sorts first, but only s.t1 means the same.
CREATE SCHEMA s;

CREATE TABLE s.gone (a int, b int,
  CONSTRAINT ck CHECK (b BETWEEN 0 AND 9 AND a >= 0));
CREATE TABLE s.t1 (a int, b int,
  CONSTRAINT ck CHECK (b BETWEEN 0 AND 10 AND a >= 0));
