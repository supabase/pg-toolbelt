-- A table, a domain, and a foreign table whose constraints Postgres names after
-- them, and a check named by hand that the rename leaves alone.
CREATE SCHEMA s;

CREATE TABLE s.t1 (
  id int PRIMARY KEY,
  a int UNIQUE CHECK (a >= 0) CONSTRAINT t1_kept CHECK (a >= 0)
);

-- a column and another table's check may reuse t2's generated names
CREATE TABLE s.z (t2_pkey int, a int CONSTRAINT t2_a_check CHECK (a >= 0));

CREATE DOMAIN s.d1 AS int CHECK (VALUE >= 0);

CREATE FOREIGN DATA WRAPPER w;
CREATE SERVER srv FOREIGN DATA WRAPPER w;
CREATE FOREIGN TABLE s.f1 (a int CHECK (a >= 0)) SERVER srv;
