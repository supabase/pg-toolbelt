-- A sub-partitioned partition whose partitioned index was created without the
-- parent index's fillfactor and then attached. PARTITION OF would copy the
-- parent's options, and Postgres rejects SET/RESET on a partitioned index.
CREATE SCHEMA s;
CREATE TABLE s.p (a int, b int) PARTITION BY RANGE (a);
CREATE INDEX p_b_idx ON ONLY s.p (b) WITH (fillfactor = 70);
CREATE TABLE s.c (a int, b int) PARTITION BY RANGE (a);
CREATE INDEX c_b_idx ON ONLY s.c (b);
ALTER TABLE s.p ATTACH PARTITION s.c FOR VALUES FROM (0) TO (10);
ALTER INDEX s.p_b_idx ATTACH PARTITION s.c_b_idx;
