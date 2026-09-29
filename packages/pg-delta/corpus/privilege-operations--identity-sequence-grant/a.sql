-- state A: identity column, no grant on its backing sequence
DO $$ BEGIN CREATE ROLE corpus_idseq_r NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA test_schema;
CREATE TABLE test_schema.t_ident (id bigint GENERATED ALWAYS AS IDENTITY, v int);
