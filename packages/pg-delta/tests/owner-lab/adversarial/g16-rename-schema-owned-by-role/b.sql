CREATE ROLE app_owner NOLOGIN;
GRANT app_owner TO current_user;
CREATE SCHEMA app AUTHORIZATION app_owner;
SET ROLE app_owner;
CREATE TABLE app.t (id int);
RESET ROLE;
REVOKE app_owner FROM current_user;
