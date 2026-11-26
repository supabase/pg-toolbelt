CREATE SCHEMA s;

CREATE TABLE s.z_parent (id int);
CREATE TABLE s.a_child (note text) INHERITS (s.z_parent);
