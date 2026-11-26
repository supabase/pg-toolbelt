-- An inheritance parent with an FK to its own child becomes partitioned, and
-- the child becomes a plain table.
CREATE SCHEMA s;

CREATE TABLE s.p (id bigint NOT NULL, k date NOT NULL);
CREATE TABLE s.c () INHERITS (s.p);
ALTER TABLE s.c ADD PRIMARY KEY (id);
ALTER TABLE s.p ADD CONSTRAINT p_fk FOREIGN KEY (id) REFERENCES s.c (id);
