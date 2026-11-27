-- Another table has an FK to the partitioned table, so PostgreSQL keeps a
-- pg_constraint row per partition and refuses to drop a partition directly.
CREATE SCHEMA s;

CREATE TABLE s.t (id bigint NOT NULL, k int NOT NULL) PARTITION BY RANGE (k);
CREATE TABLE s.t_a PARTITION OF s.t FOR VALUES FROM (0) TO (100);
ALTER TABLE s.t ADD PRIMARY KEY (id, k);
CREATE TABLE s.r (id bigint, k int, FOREIGN KEY (id, k) REFERENCES s.t (id, k));
