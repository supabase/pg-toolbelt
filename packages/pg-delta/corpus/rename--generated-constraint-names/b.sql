-- All three renamed; the generated constraint names follow the new names.
CREATE SCHEMA s;

CREATE TABLE s.t2 (
  id int PRIMARY KEY,
  a int UNIQUE CHECK (a >= 0) CONSTRAINT t1_kept CHECK (a >= 0)
);

-- a column and another table's check may reuse t2's generated names
CREATE TABLE s.z (t2_pkey int, a int CONSTRAINT t2_a_check CHECK (a >= 0));

CREATE DOMAIN s.d2 AS int CHECK (VALUE >= 0);

CREATE FOREIGN DATA WRAPPER w;
CREATE SERVER srv FOREIGN DATA WRAPPER w;
CREATE FOREIGN TABLE s.f2 (a int CHECK (a >= 0)) SERVER srv;
