-- An existing child starts (or stops) redeclaring an inherited column. Neither
-- ADD COLUMN nor DROP COLUMN on the child can express it.
CREATE SCHEMA s;

CREATE TABLE s.a_parent (id int, x int);
CREATE TABLE s.z_child (note text) INHERITS (s.a_parent);
