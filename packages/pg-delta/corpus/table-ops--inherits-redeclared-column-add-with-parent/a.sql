-- Parent and kept child both gain x, the child redeclaring it. The child's
-- ADD COLUMN has to run before the parent's (Postgres merges a parent ADD
-- COLUMN into a same-named child column; the other way round the child's ADD
-- fails with "already exists"). The parent's name sorts first so the name
-- tie-break cannot hide a missing ordering edge.
CREATE SCHEMA s;

CREATE TABLE s.a_parent (id int);
CREATE TABLE s.z_child (note text) INHERITS (s.a_parent);
