-- state A: default privileges grant ALL ON TABLES (tables, views, matviews) to
-- two roles; no relation exists yet
DO $$ BEGIN CREATE ROLE corpus_colgrant_adp NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE corpus_colgrant_adp_colonly NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA test_schema;
ALTER DEFAULT PRIVILEGES IN SCHEMA test_schema
  GRANT ALL ON TABLES TO corpus_colgrant_adp, corpus_colgrant_adp_colonly;
