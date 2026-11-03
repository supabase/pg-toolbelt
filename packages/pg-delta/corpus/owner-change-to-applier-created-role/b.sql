-- state B: the applier created a role and handed the function to it. The
-- applier is not left a member, so neither direction's OWNER TO is directly
-- runnable (#563): PG <= 15 needs membership, PG16+ needs SET on the role.
CREATE SCHEMA crl_own;
CREATE FUNCTION crl_own.f() RETURNS integer LANGUAGE sql AS 'SELECT 1';
CREATE ROLE crl_owner NOLOGIN;
GRANT CREATE ON SCHEMA crl_own TO crl_owner;
GRANT crl_owner TO current_user;
ALTER FUNCTION crl_own.f() OWNER TO crl_owner;
REVOKE crl_owner FROM current_user;
