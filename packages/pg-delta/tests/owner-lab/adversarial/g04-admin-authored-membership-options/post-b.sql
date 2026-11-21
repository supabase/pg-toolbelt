CREATE ROLE app_owner NOLOGIN;
GRANT app_owner TO lab_applier WITH ADMIN OPTION;
CREATE SCHEMA app AUTHORIZATION app_owner;
CREATE TABLE app.t (id int);
ALTER TABLE app.t OWNER TO app_owner;
