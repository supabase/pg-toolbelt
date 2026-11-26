-- A child that redeclares a column it also inherits (attislocal and
-- attinhcount > 0), with a default of its own. Postgres merges the two
-- declarations in CREATE TABLE ... INHERITS; a later ADD COLUMN on the child
-- fails with "already exists".
CREATE SCHEMA s;

CREATE TABLE s.a_parent (id int, x int);
CREATE TABLE s.z_child (x int DEFAULT 7, note text) INHERITS (s.a_parent);
