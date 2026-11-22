CREATE ROLE app_owner NOLOGIN;
GRANT devs TO app_owner;
CREATE TABLE svc.t (id int);
GRANT app_owner TO current_user;
ALTER TABLE svc.t OWNER TO app_owner;
REVOKE app_owner FROM current_user;
