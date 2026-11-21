CREATE ROLE r_own NOLOGIN;
GRANT r_own TO current_user;
CREATE SCHEMA s AUTHORIZATION r_own;
REVOKE r_own FROM current_user;
