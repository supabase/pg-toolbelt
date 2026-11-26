-- A new partition whose attached index is named something other than the name
-- PostgreSQL generates.
CREATE SCHEMA s;

CREATE TABLE s.t (id bigint, k date NOT NULL) PARTITION BY LIST (k);
CREATE INDEX t_ix ON s.t (k);
