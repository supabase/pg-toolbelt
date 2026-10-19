-- retyping a parent column rewrites its partitions and inheritance children

CREATE SCHEMA s;
CREATE TABLE s.parent (id int, a integer) PARTITION BY RANGE (id);
CREATE TABLE s.part1 PARTITION OF s.parent FOR VALUES FROM (0) TO (100);
CREATE TABLE s.base (id int, a integer);
CREATE TABLE s.child () INHERITS (s.base);
CREATE TABLE s.grandchild () INHERITS (s.child);
