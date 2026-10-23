CREATE SCHEMA s;

CREATE TABLE s.t2 (a int DEFAULT 2, b int,
  CONSTRAINT ck CHECK ((((b >= 0) AND (b <= 10)) AND (a >= 0))));
