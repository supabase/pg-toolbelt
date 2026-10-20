-- retyping a column of a second parent rewrites the multi-parent child
CREATE SCHEMA s;
CREATE TABLE s.base1 (id int);
CREATE TABLE s.base2 (a integer);
CREATE TABLE s.child () INHERITS (s.base1, s.base2);
