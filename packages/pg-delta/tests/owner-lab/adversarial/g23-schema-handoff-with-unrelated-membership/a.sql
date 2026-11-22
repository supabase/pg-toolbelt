CREATE ROLE old_owner NOLOGIN;
CREATE ROLE new_owner NOLOGIN;
CREATE ROLE runtime NOLOGIN;
CREATE ROLE readers NOLOGIN;
GRANT old_owner TO current_user;
CREATE SCHEMA app AUTHORIZATION old_owner;
REVOKE old_owner FROM current_user;
