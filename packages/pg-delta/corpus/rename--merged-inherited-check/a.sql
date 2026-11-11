-- A child's generated check merged with its parent's check of the same name
-- (the parent has no columns, so only the check is merged): renaming the
-- parent's constraint renames the child's too.
CREATE SCHEMA s;

CREATE TABLE s.c1 (a int, CHECK (1 > 0));
CREATE TABLE s.p (CONSTRAINT c1_check CHECK (1 > 0));
ALTER TABLE s.c1 INHERIT s.p;
