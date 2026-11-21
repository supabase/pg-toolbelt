CREATE ROLE app_owner_role NOLOGIN;
CREATE SCHEMA s;
GRANT USAGE, CREATE ON SCHEMA s TO app_owner_role;
CREATE TABLE s.t (id int);
GRANT app_owner_role TO current_user;
ALTER TABLE s.t OWNER TO app_owner_role;
REVOKE app_owner_role FROM current_user;
