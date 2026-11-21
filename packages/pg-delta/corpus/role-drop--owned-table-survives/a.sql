-- state A: role app_owner owns app.t and holds USAGE, CREATE on schema app
CREATE ROLE app_owner NOLOGIN;
CREATE SCHEMA app;
GRANT USAGE, CREATE ON SCHEMA app TO app_owner;
CREATE TABLE app.t (id int);
ALTER TABLE app.t OWNER TO app_owner;
