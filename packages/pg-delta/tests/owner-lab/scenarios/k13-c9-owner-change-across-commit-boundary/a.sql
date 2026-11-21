CREATE SCHEMA s;
CREATE TYPE s.mood AS ENUM ('a','b');
CREATE TABLE s.t (id int, m s.mood);
