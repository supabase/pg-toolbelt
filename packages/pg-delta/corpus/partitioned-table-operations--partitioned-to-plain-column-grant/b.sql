DO $$ BEGIN CREATE ROLE corpus_ptp_reader NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE t (id bigint, k date NOT NULL, a numeric);
