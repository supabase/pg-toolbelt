-- state A: a stored generated column (v DEFAULT 0 makes the seeded row read
-- id = 1 on both sides), with a SEQUENCES default privilege active
-- in the schema. Turning it into an identity column in B replaces the column
-- (generation expression → identity), so the backing sequence is materialized by
-- the column's re-create, not by an ADD IDENTITY alter.
DO $$ BEGIN CREATE ROLE corpus_idseq_gen_r NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA test_schema;
CREATE TABLE test_schema.t_gen (v int DEFAULT 0, id int GENERATED ALWAYS AS (v + 1) STORED);
ALTER DEFAULT PRIVILEGES IN SCHEMA test_schema GRANT USAGE ON SEQUENCES TO corpus_idseq_gen_r;
