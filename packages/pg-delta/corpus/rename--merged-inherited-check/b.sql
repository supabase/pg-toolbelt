-- The child renamed, and the parent's check with it.
CREATE SCHEMA s;

CREATE TABLE s.c2 (a int, CHECK (1 > 0));
CREATE TABLE s.p (CONSTRAINT c2_check CHECK (1 > 0));
ALTER TABLE s.c2 INHERIT s.p;
