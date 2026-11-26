-- The owner role is renamed while the server it owns, and the role's user
-- mapping on it, are dropped: the rename must not wait on the server drop.
CREATE ROLE corpus_fsrv_owner_old NOLOGIN;
ALTER ROLE corpus_fsrv_owner_old SET statement_timeout = '271828ms';
CREATE FOREIGN DATA WRAPPER corpus_fdw;
GRANT USAGE ON FOREIGN DATA WRAPPER corpus_fdw TO corpus_fsrv_owner_old;
CREATE SERVER corpus_srv FOREIGN DATA WRAPPER corpus_fdw;
ALTER SERVER corpus_srv OWNER TO corpus_fsrv_owner_old;
CREATE USER MAPPING FOR corpus_fsrv_owner_old SERVER corpus_srv;
