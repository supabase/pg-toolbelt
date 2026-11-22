CREATE ROLE owner_a NOLOGIN;
CREATE ROLE owner_b NOLOGIN;
GRANT owner_b TO current_user;
CREATE SCHEMA app;
GRANT CREATE, USAGE ON SCHEMA app TO owner_a, owner_b;
CREATE TABLE app.t (id int);
ALTER TABLE app.t OWNER TO owner_b;
REVOKE owner_b FROM current_user;
