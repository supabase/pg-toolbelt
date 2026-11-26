-- Parent and redeclaring child both lose x while the child is kept. The child's
-- own declaration has to go after the parent's (a child-first DROP COLUMN fails
-- with "cannot drop inherited column"). The child's name sorts first so the
-- name tie-break cannot hide a missing ordering edge.
CREATE SCHEMA s;

CREATE TABLE s.z_parent (id int, x int);
CREATE TABLE s.a_child (x int, note text) INHERITS (s.z_parent);
