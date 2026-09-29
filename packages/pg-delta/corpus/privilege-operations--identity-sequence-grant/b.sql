-- state B: USAGE on the identity column's backing sequence granted to a role
DO $$ BEGIN CREATE ROLE corpus_idseq_r NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA test_schema;
CREATE TABLE test_schema.t_ident (id bigint GENERATED ALWAYS AS IDENTITY, v int);
GRANT USAGE ON SEQUENCE test_schema.t_ident_id_seq TO corpus_idseq_r;
