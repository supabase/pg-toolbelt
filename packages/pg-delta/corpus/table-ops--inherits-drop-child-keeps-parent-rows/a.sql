-- Dropping an inheritance child must not read as row loss on its parent: a
-- plain count(*) on the parent includes the child's rows.
CREATE SCHEMA s;

CREATE TABLE s.p (id bigint NOT NULL);
CREATE TABLE s.c () INHERITS (s.p);
