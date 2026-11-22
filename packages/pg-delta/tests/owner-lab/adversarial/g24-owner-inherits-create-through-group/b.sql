CREATE ROLE devs NOLOGIN;
CREATE ROLE app_owner NOLOGIN;
GRANT devs TO app_owner;
CREATE SCHEMA svc;
GRANT CREATE, USAGE ON SCHEMA svc TO devs;
CREATE TABLE svc.t (id int);
GRANT app_owner TO current_user;
ALTER TABLE svc.t OWNER TO app_owner;
REVOKE app_owner FROM current_user;
