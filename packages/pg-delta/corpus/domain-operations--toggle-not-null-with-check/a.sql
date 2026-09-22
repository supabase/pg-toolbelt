-- nullable domain with a DEFAULT and a named CHECK constraint
CREATE SCHEMA core;

CREATE DOMAIN core.percentage AS numeric(7, 6) DEFAULT 0
  CONSTRAINT percentage_between_0_and_1 CHECK (VALUE >= 0 AND VALUE <= 1);
