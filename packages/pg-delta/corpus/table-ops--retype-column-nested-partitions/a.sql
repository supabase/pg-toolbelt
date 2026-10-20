-- retyping a column rewrites every level of a sub-partitioned table
CREATE SCHEMA s;
CREATE TABLE s.p (id int, k int, a integer) PARTITION BY RANGE (id);
CREATE TABLE s.p1 PARTITION OF s.p FOR VALUES FROM (0) TO (100) PARTITION BY LIST (k);
CREATE TABLE s.p1a PARTITION OF s.p1 FOR VALUES IN (1);
CREATE TABLE s.p1b PARTITION OF s.p1 DEFAULT;
