CREATE ROLE h_hold NOLOGIN;
CREATE ROLE x_reader NOLOGIN;
CREATE SCHEMA s;
GRANT USAGE, CREATE ON SCHEMA s TO h_hold;
CREATE TABLE s.t (id int);
CREATE TABLE s.u (id int);
GRANT h_hold TO current_user;
ALTER TABLE s.u OWNER TO h_hold;
REVOKE h_hold FROM current_user;
