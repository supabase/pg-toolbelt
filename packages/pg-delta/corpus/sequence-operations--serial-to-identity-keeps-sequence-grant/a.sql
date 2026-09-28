-- state A: serial column whose standalone sequence carries a third-party grant.
DO $$ BEGIN CREATE ROLE corpus_serial_ident_r NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA test_schema;
CREATE TABLE test_schema.t_ser (id serial, v int);
GRANT USAGE ON SEQUENCE test_schema.t_ser_id_seq TO corpus_serial_ident_r;
