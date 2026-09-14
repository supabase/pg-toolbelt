-- state B: plain column — DROP IDENTITY removes the sequence and its grant
DO $$ BEGIN CREATE ROLE corpus_idseq_drop_r NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA test_schema;
CREATE TABLE test_schema.t_ident (id bigint NOT NULL, v int);
