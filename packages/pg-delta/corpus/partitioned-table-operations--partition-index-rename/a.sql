-- The name of a partition's index changes. The index is attached to the
-- parent's partitioned index, so it cannot be dropped on its own.
CREATE SCHEMA s;

CREATE TABLE s.t (id bigint, k date NOT NULL) PARTITION BY LIST (k);
CREATE TABLE s.t_a PARTITION OF s.t FOR VALUES IN ('2000-01-01');
CREATE INDEX t_ix ON s.t (k);
