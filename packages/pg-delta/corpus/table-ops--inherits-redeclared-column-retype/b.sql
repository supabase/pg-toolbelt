CREATE SCHEMA s;

CREATE TABLE s.a_parent (id int, x text);
CREATE TABLE s.z_child (x text, note text) INHERITS (s.a_parent);
