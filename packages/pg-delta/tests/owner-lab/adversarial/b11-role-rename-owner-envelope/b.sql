CREATE ROLE app_owner_role2 NOLOGIN;
CREATE SCHEMA s;
GRANT USAGE, CREATE ON SCHEMA s TO app_owner_role2;
CREATE TABLE s.t (id int, extra int);
GRANT app_owner_role2 TO current_user;
ALTER TABLE s.t OWNER TO app_owner_role2;
REVOKE app_owner_role2 FROM current_user;
