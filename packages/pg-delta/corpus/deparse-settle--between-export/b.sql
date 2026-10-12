-- What `schema export` writes for a.sql: Postgres's printout of the nested
-- tree. Loading it parses it again, which flattens it, so this side is ahead
-- of a.sql by one parse. Both mean the same thing: the plans must be empty.
CREATE SCHEMA s;

CREATE TABLE s.p (
  a int,
  b int,
  CONSTRAINT p_check CHECK ((((b >= 0) AND (b <= 10)) AND (a >= 0)))
);

CREATE INDEX p_idx ON s.p USING btree (a) WHERE (((b >= 0) AND (b <= 10)) AND (a >= 0));

CREATE VIEW s.pv AS SELECT a FROM s.p WHERE (((b >= 0) AND (b <= 10)) AND (a >= 0));

ALTER TABLE s.p ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_sel ON s.p FOR SELECT USING ((((b >= 0) AND (b <= 10)) AND (a >= 0)));
