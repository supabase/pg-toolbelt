-- A table leaves (a to b) or joins (b to a) an inheritance parent. PostgreSQL
-- does both in place with NO INHERIT / INHERIT; the rows must not be rebuilt.
CREATE SCHEMA s;

CREATE TABLE s.p (id bigint NOT NULL);
CREATE TABLE s.c () INHERITS (s.p);
