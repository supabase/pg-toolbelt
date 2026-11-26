-- state B: owned by the applying role, with an explicit grant to the previous
-- owner. ALTER ... OWNER TO moves the old owner's ACL entries to the new owner,
-- so the grant must be issued after the owner change.
CREATE ROLE corpus_prev_owner NOLOGIN;
CREATE FUNCTION f() RETURNS integer LANGUAGE sql AS 'SELECT 0';
GRANT EXECUTE ON FUNCTION f() TO corpus_prev_owner;
