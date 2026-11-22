CREATE ROLE owner_a NOLOGIN;
CREATE ROLE owner_b NOLOGIN;
GRANT owner_a TO current_user;
CREATE SCHEMA app;
GRANT CREATE, USAGE ON SCHEMA app TO owner_a;
CREATE TABLE app.t (id int);
ALTER TABLE app.t OWNER TO owner_a;
REVOKE owner_a FROM current_user;
