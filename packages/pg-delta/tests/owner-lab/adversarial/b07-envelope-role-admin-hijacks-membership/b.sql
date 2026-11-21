CREATE ROLE h_hold NOLOGIN;
CREATE ROLE m NOLOGIN;
CREATE SCHEMA s;
GRANT USAGE, CREATE ON SCHEMA s TO h_hold;
CREATE TABLE s.u (id int, extra int);
GRANT h_hold TO current_user;
ALTER TABLE s.u OWNER TO h_hold;
REVOKE h_hold FROM current_user;
