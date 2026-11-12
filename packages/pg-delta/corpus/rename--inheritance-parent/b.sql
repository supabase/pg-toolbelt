-- q1 and r1 renamed; their children and partition are kept.
CREATE SCHEMA s;

CREATE TABLE s.q2 (x int);
CREATE TABLE s.o (y int);
CREATE TABLE s.m (z int) INHERITS (s.o, s.q2);

CREATE TABLE s.r2 (k int NOT NULL) PARTITION BY RANGE (k);
CREATE TABLE s.r1_p0 PARTITION OF s.r2 FOR VALUES FROM (0) TO (10);
