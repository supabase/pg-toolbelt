-- Membership moves from the parent (which covers its child) to the child alone.
CREATE SCHEMA s;

CREATE TABLE s.p (id bigint);
CREATE TABLE s.c () INHERITS (s.p);
CREATE PUBLICATION pub_inh;
ALTER PUBLICATION pub_inh ADD TABLE s.p;
