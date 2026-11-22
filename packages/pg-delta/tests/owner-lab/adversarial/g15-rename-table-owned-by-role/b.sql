CREATE ROLE app_owner NOLOGIN;
GRANT app_owner TO current_user;
CREATE SCHEMA app;
GRANT CREATE, USAGE ON SCHEMA app TO app_owner;
CREATE TABLE app.t2 (id int);
ALTER TABLE app.t2 OWNER TO app_owner;
REVOKE app_owner FROM current_user;
