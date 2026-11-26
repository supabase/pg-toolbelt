CREATE SCHEMA s;

CREATE TABLE s.p (a numeric);
CREATE TABLE s.c (a numeric NOT NULL) INHERITS (s.p);
