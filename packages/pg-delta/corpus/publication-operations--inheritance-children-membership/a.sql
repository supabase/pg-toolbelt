-- ADD TABLE p (without ONLY) also adds p's inheritance child c, and DROP TABLE p
-- removes it again.
CREATE SCHEMA s;

CREATE TABLE s.p (id bigint);
CREATE TABLE s.c () INHERITS (s.p);
CREATE PUBLICATION pub_inh;
