CREATE ROLE o_own NOLOGIN;
CREATE SCHEMA s;
GRANT USAGE, CREATE ON SCHEMA s TO o_own;
CREATE TYPE s.mood AS ENUM ('a', 'b');
CREATE TABLE s.t (id int, m s.mood DEFAULT 'a');
GRANT o_own TO current_user;
ALTER TYPE s.mood OWNER TO o_own;
ALTER TABLE s.t OWNER TO o_own;
REVOKE o_own FROM current_user;
