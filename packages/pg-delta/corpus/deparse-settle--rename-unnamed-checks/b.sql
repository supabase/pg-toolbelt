-- The table is renamed; its unnamed checks mean the same but load nested.
CREATE SCHEMA s;

CREATE TABLE s.t2 (id int PRIMARY KEY, a int, b int,
  CHECK (a BETWEEN 0 AND 5 AND id >= 0),
  CHECK (b BETWEEN 0 AND 5 AND id >= 0));
