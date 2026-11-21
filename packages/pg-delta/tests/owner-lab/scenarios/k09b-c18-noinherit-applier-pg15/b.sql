CREATE SCHEMA s;
CREATE ROLE r NOLOGIN;
GRANT r TO current_user;
ALTER SCHEMA s OWNER TO r;
SET ROLE r;
CREATE TABLE s.t (id int, note text);
RESET ROLE;
REVOKE r FROM current_user;
