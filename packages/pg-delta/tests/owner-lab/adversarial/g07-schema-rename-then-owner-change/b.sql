CREATE ROLE app_owner NOLOGIN;
GRANT app_owner TO current_user;
CREATE SCHEMA app;
CREATE TABLE app.t (id int);
GRANT CREATE, USAGE ON SCHEMA app TO app_owner;
ALTER TABLE app.t OWNER TO app_owner;
