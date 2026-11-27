-- A hash partition moves to another remainder while a sibling partition has an
-- FK to the partitioned table.
CREATE SCHEMA s;

CREATE TABLE s.t (id bigint NOT NULL, k text NOT NULL) PARTITION BY HASH (k);
CREATE TABLE s.t_a PARTITION OF s.t FOR VALUES WITH (MODULUS 4, REMAINDER 3);
CREATE TABLE s.t_b PARTITION OF s.t FOR VALUES WITH (MODULUS 4, REMAINDER 0);
ALTER TABLE s.t ADD PRIMARY KEY (id, k);
ALTER TABLE s.t_b ADD CONSTRAINT t_b_fk FOREIGN KEY (id, k) REFERENCES s.t (id, k);
