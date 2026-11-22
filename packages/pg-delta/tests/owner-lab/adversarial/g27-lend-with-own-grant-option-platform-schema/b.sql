CREATE ROLE app_owner NOLOGIN;
CREATE TABLE svc.t (id int);
GRANT app_owner TO current_user;
GRANT CREATE ON SCHEMA svc TO app_owner;
ALTER TABLE svc.t OWNER TO app_owner;
REVOKE CREATE ON SCHEMA svc FROM app_owner;
REVOKE app_owner FROM current_user;
