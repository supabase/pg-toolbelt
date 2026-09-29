-- state B: identity column created BEFORE the default privilege, so its
-- backing sequence carries no grant for the role.
DO $$ BEGIN CREATE ROLE corpus_idseq_gen_r NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA test_schema;
CREATE TABLE test_schema.t_gen (v int DEFAULT 0, id int GENERATED ALWAYS AS IDENTITY);
ALTER DEFAULT PRIVILEGES IN SCHEMA test_schema GRANT USAGE ON SEQUENCES TO corpus_idseq_gen_r;
