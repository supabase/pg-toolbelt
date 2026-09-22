-- same domain, now NOT NULL. PostgreSQL 17+ catalogs the domain NOT NULL as a
-- pg_constraint row (contype 'n'); it must stay modeled as the domain's
-- `notNull` attribute, not as a second constraint fact, or the plan renders
-- NOT NULL twice on CREATE and pairs SET/DROP NOT NULL with a redundant
-- ADD/DROP CONSTRAINT that fails on the reverse direction.
CREATE SCHEMA core;

CREATE DOMAIN core.percentage AS numeric(7, 6) DEFAULT 0
  CONSTRAINT percentage_between_0_and_1 CHECK (VALUE >= 0 AND VALUE <= 1)
  NOT NULL;
