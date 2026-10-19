-- adding a volatile-default column recurses into partitions and children
CREATE SCHEMA s;
CREATE TABLE s.p (id int) PARTITION BY RANGE (id);
CREATE TABLE s.p1 PARTITION OF s.p FOR VALUES FROM (0) TO (100);
CREATE TABLE s.base (id int);
CREATE TABLE s.child () INHERITS (s.base);
