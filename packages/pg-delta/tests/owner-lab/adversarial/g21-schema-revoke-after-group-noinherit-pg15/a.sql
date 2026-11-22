CREATE ROLE deploy_team NOLOGIN;
GRANT deploy_team TO current_user;
CREATE ROLE app_owner NOLOGIN;
GRANT app_owner TO deploy_team;
CREATE SCHEMA app AUTHORIZATION app_owner;
GRANT USAGE ON SCHEMA app TO PUBLIC;
