CREATE SCHEMA s;
CREATE TABLE s.p (id int, t timestamptz DEFAULT clock_timestamp()) PARTITION BY RANGE (id);
CREATE TABLE s.p1 PARTITION OF s.p FOR VALUES FROM (0) TO (100);
CREATE TABLE s.base (id int, t timestamptz DEFAULT clock_timestamp());
CREATE TABLE s.child () INHERITS (s.base);
