-- NOT NULL domain with a DEFAULT and a named CHECK, created from scratch.
-- PostgreSQL 17+ catalogs the domain NOT NULL as a pg_constraint row
-- (contype 'n'). If that row became a constraint fact, CREATE DOMAIN would
-- inline it as a second `CONSTRAINT "<domain>_not_null" NOT NULL`, which
-- PostgreSQL rejects ("constraint … already exists" on 17, "redundant NOT NULL
-- constraint definition" on 18).
CREATE SCHEMA core;

CREATE DOMAIN core.percentage AS numeric(7, 6) DEFAULT 0
  CONSTRAINT percentage_between_0_and_1 CHECK (VALUE >= 0 AND VALUE <= 1)
  NOT NULL;
