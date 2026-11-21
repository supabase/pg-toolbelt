CREATE SCHEMA app AUTHORIZATION app_owner;
CREATE TABLE app.t (id int);
ALTER TABLE app.t OWNER TO app_owner;
ALTER TABLE app.t ADD COLUMN note text;
