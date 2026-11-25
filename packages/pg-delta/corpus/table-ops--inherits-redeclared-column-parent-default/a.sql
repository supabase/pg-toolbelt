-- The parent has a default and the redeclaring child has none. Creating the
-- child copies the parent default unless the child suppresses it.
CREATE SCHEMA s;

CREATE TABLE s.a_parent (id int, x int DEFAULT 5);
CREATE TABLE s.z_child (x int) INHERITS (s.a_parent);
ALTER TABLE s.z_child ALTER COLUMN x DROP DEFAULT;
