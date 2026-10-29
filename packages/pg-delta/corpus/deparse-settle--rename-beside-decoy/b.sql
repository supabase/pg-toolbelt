-- s.t1 renamed, its check in the text an export writes.
CREATE SCHEMA s;

CREATE TABLE s.t2 (a int, b int,
  CONSTRAINT ck CHECK ((((b >= 0) AND (b <= 10)) AND (a >= 0))));
