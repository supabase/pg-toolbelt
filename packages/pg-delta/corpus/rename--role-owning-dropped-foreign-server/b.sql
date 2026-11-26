CREATE ROLE corpus_fsrv_owner_new NOLOGIN;
ALTER ROLE corpus_fsrv_owner_new SET statement_timeout = '271828ms';
CREATE FOREIGN DATA WRAPPER corpus_fdw;
GRANT USAGE ON FOREIGN DATA WRAPPER corpus_fdw TO corpus_fsrv_owner_new;
