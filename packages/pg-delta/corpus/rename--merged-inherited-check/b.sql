-- The child renamed, and the parent's check with it.
CREATE SCHEMA s;

CREATE TABLE s.c2 (a int, CHECK (1 > 0));
CREATE TABLE s.p (CONSTRAINT c2_check CHECK (1 > 0));
ALTER TABLE s.c2 INHERIT s.p;

-- The parent renamed, and the child's merged check with it.
CREATE TABLE s.q2 (CHECK (1 > 0));
CREATE TABLE s.d (a int, CONSTRAINT q2_check CHECK (1 > 0));
ALTER TABLE s.d INHERIT s.q2;
