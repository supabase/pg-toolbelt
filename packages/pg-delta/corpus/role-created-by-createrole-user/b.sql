-- state B: roles created by the CREATEROLE applier, plus an explicit
-- membership the applier granted (grantor = applier, not oid 10).
CREATE ROLE crl_parent NOLOGIN;
CREATE ROLE crl_child NOLOGIN;
GRANT crl_parent TO crl_child;
CREATE TABLE crl_t (id integer);
GRANT SELECT ON crl_t TO crl_child;
