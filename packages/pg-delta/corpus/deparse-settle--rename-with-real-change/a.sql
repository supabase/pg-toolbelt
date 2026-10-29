-- The rename also changes a default, so the table is rebuilt.
CREATE SCHEMA s;

CREATE TABLE s.t1 (a int DEFAULT 1, b int,
  CONSTRAINT ck CHECK (b BETWEEN 0 AND 10 AND a >= 0));
