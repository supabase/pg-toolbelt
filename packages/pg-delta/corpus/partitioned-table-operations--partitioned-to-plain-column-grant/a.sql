-- A partitioned table becomes a plain table (a replace) while it carries a
-- column-level grant.
DO $$ BEGIN CREATE ROLE corpus_ptp_reader NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE t (id bigint, k date NOT NULL, a numeric) PARTITION BY LIST (k);
GRANT SELECT (a) ON t TO corpus_ptp_reader;
