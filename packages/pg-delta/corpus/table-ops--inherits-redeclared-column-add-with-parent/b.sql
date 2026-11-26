CREATE SCHEMA s;

CREATE TABLE s.a_parent (id int, x int);
CREATE TABLE s.z_child (x int, note text) INHERITS (s.a_parent);
