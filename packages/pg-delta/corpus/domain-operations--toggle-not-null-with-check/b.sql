-- same domain, now NOT NULL. PostgreSQL 17+ catalogs the domain NOT NULL as a
-- pg_constraint row (contype 'n'); it must stay modeled as the domain's
-- `notNull` attribute, not as a second constraint fact, or the toggle renders a
-- redundant ADD/DROP CONSTRAINT next to SET/DROP NOT NULL and the fact hashes
-- differ across PG versions.
CREATE SCHEMA core;

CREATE DOMAIN core.percentage AS numeric(7, 6) DEFAULT 0
  CONSTRAINT percentage_between_0_and_1 CHECK (VALUE >= 0 AND VALUE <= 1)
  NOT NULL;
