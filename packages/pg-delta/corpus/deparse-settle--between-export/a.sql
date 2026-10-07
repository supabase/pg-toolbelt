-- A hand-written migration: Postgres expands each BETWEEN into an AND and keeps
-- it nested under the outer AND, a tree no SQL text parses back into.
CREATE SCHEMA s;

CREATE TABLE s.p (
  a int,
  b int,
  CONSTRAINT p_check CHECK (b BETWEEN 0 AND 10 AND a >= 0)
);

CREATE INDEX p_idx ON s.p (a) WHERE b BETWEEN 0 AND 10 AND a >= 0;

CREATE VIEW s.pv AS SELECT a FROM s.p WHERE b BETWEEN 0 AND 10 AND a >= 0;

ALTER TABLE s.p ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_sel ON s.p FOR SELECT USING (b BETWEEN 0 AND 10 AND a >= 0);
