CREATE SCHEMA app AUTHORIZATION namespace_owner;
GRANT USAGE, CREATE ON SCHEMA app TO lab_applier;
GRANT USAGE ON SCHEMA app TO app_owner;
SET ROLE lab_applier;
CREATE TABLE app.t (id int);
RESET ROLE;
