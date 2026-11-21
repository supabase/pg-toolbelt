CREATE ROLE app_owner NOLOGIN;
GRANT app_owner TO current_user;
CREATE SCHEMA legacy;
CREATE TABLE legacy.t (id int);
GRANT CREATE, USAGE ON SCHEMA legacy TO app_owner;
