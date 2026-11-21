CREATE ROLE e_hold NOLOGIN;
CREATE ROLE m NOLOGIN;
CREATE SCHEMA s;
GRANT USAGE, CREATE ON SCHEMA s TO e_hold;
CREATE TABLE s.u (id int, extra int);
GRANT e_hold TO current_user;
ALTER TABLE s.u OWNER TO e_hold;
REVOKE e_hold FROM current_user;
