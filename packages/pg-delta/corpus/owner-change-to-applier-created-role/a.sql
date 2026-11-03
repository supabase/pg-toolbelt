-- state A: a function owned by the applier (a CREATEROLE non-superuser).
CREATE SCHEMA crl_own;
CREATE FUNCTION crl_own.f() RETURNS integer LANGUAGE sql AS 'SELECT 1';
