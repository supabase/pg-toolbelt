-- Parent and a child that redeclares the inherited column both change its type.
-- Only the parent's ALTER COLUMN TYPE is valid; it reaches the child.
CREATE SCHEMA s;

CREATE TABLE s.a_parent (id int, x int);
CREATE TABLE s.z_child (x int, note text) INHERITS (s.a_parent);
