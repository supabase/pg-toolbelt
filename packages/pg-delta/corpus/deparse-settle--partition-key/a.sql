-- The text Postgres settles on for b.sql's partition key.
CREATE SCHEMA s;

CREATE TABLE s.pt (a int, b int)
  PARTITION BY LIST ((((b >= 0) AND (b <= 10) AND (a >= 0))));
CREATE TABLE s.pt_in PARTITION OF s.pt FOR VALUES IN (true);
CREATE TABLE s.pt_rest PARTITION OF s.pt DEFAULT;
