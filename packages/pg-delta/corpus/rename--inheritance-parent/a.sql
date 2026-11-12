-- Parents with children that refer to them by name: a child of two parents
-- and a partitioned table with a partition.
CREATE SCHEMA s;

CREATE TABLE s.q1 (x int);
CREATE TABLE s.o (y int);
CREATE TABLE s.m (z int) INHERITS (s.o, s.q1);

CREATE TABLE s.r1 (k int NOT NULL) PARTITION BY RANGE (k);
CREATE TABLE s.r1_p0 PARTITION OF s.r1 FOR VALUES FROM (0) TO (10);
