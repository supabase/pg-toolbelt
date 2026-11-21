CREATE SCHEMA app AUTHORIZATION app_owner;
GRANT USAGE, CREATE ON SCHEMA app TO app_writer;
SET ROLE lab_applier;
CREATE TABLE app.jobs (id int);
RESET ROLE;
