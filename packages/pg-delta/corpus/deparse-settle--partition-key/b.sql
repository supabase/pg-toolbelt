-- A BETWEEN on the left of the same AND in a partition key prints nested on
-- its first parse and flat after a replay. A partition-key change replaces the
-- partitioned table, so neither direction may plan anything.
CREATE SCHEMA s;

CREATE TABLE s.pt (a int, b int)
  PARTITION BY LIST ((b BETWEEN 0 AND 10 AND a >= 0));
CREATE TABLE s.pt_in PARTITION OF s.pt FOR VALUES IN (true);
CREATE TABLE s.pt_rest PARTITION OF s.pt DEFAULT;
