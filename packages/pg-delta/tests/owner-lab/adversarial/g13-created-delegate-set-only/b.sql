CREATE ROLE app_owner NOLOGIN;
GRANT app_owner TO current_user;
CREATE SCHEMA app;
GRANT USAGE, CREATE ON SCHEMA app TO app_owner;
CREATE TABLE app.t (id int);
ALTER TABLE app.t OWNER TO app_owner;
CREATE ROLE reporting_delegate NOLOGIN;
GRANT reporting_delegate TO current_user WITH INHERIT FALSE, SET TRUE;
GRANT SELECT ON app.t TO reporting_delegate WITH GRANT OPTION;
