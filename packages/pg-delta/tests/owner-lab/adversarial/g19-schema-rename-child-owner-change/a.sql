CREATE ROLE owner_a NOLOGIN;
CREATE ROLE owner_b NOLOGIN;
GRANT owner_a TO current_user;
CREATE SCHEMA legacy;
GRANT CREATE, USAGE ON SCHEMA legacy TO owner_a, owner_b;
CREATE TABLE legacy.t (id int);
ALTER TABLE legacy.t OWNER TO owner_a;
REVOKE owner_a FROM current_user;
