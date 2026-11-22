CREATE ROLE deploy_team NOLOGIN;
GRANT deploy_team TO current_user;
CREATE ROLE app_owner NOLOGIN;
GRANT app_owner TO current_user;
CREATE SCHEMA app AUTHORIZATION app_owner;
REVOKE app_owner FROM current_user;
