CREATE SCHEMA s;
CREATE ROLE r NOLOGIN;
GRANT USAGE, CREATE ON SCHEMA s TO r;
CREATE TYPE s.mood AS ENUM ('a','b','c');
CREATE TABLE s.t (id int, m s.mood DEFAULT 'c');
GRANT r TO current_user;
ALTER TABLE s.t OWNER TO r;
ALTER TYPE s.mood OWNER TO r;
REVOKE r FROM current_user;
