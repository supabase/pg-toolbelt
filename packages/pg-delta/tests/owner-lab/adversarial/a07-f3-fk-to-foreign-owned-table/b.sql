CREATE ROLE r2 NOLOGIN;
CREATE SCHEMA s;
GRANT USAGE, CREATE ON SCHEMA s TO r2;
GRANT r2 TO current_user;
CREATE TABLE s.users (id int primary key);
ALTER TABLE s.users OWNER TO r2;
REVOKE r2 FROM current_user;
CREATE TABLE s.orders (id int primary key, uid int);
