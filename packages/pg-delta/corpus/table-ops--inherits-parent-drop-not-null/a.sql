-- The parent drops NOT NULL while the child keeps its own. Before PG 18,
-- DROP NOT NULL on the parent recurses and clears the child's too.
CREATE SCHEMA s;

CREATE TABLE s.p (a numeric NOT NULL);
CREATE TABLE s.c (a numeric NOT NULL) INHERITS (s.p);
