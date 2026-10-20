CREATE SCHEMA s;
CREATE TABLE s.base1 (id int);
CREATE TABLE s.base2 (a numeric);
CREATE TABLE s.child () INHERITS (s.base1, s.base2);
