-- state A: plain NOT NULL column, with a SEQUENCES default privilege active in
-- the schema. Adding identity in B materializes a backing sequence on the
-- target under that default privilege; the desired sequence carries no grant.
DO $$ BEGIN CREATE ROLE corpus_idseq_add_r NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA test_schema;
CREATE TABLE test_schema.t_ident (id bigint NOT NULL, v int);
ALTER DEFAULT PRIVILEGES IN SCHEMA test_schema GRANT USAGE ON SEQUENCES TO corpus_idseq_add_r;
