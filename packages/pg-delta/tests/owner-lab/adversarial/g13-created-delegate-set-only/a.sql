CREATE ROLE app_owner NOLOGIN;
GRANT app_owner TO current_user;
CREATE SCHEMA app;
GRANT USAGE, CREATE ON SCHEMA app TO app_owner;
CREATE TABLE app.t (id int);
ALTER TABLE app.t OWNER TO app_owner;
