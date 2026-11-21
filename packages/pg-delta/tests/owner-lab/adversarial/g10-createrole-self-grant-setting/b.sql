CREATE SCHEMA app;
CREATE TABLE app.t (id int);
CREATE ROLE app_owner NOLOGIN;
GRANT CREATE ON SCHEMA app TO app_owner;
ALTER TABLE app.t OWNER TO app_owner;
