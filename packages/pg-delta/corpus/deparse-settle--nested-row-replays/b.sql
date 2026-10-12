-- A row comparison over nested rows expands one row level per parse, so its
-- deparse needs two replays to settle on a.sql's text. The a -> b plan must
-- be empty.
CREATE SCHEMA s;

CREATE TABLE s.t (
  a int,
  b int,
  c int,
  d int,
  e int,
  CONSTRAINT ck CHECK (((a, b), (c, d), e) IS DISTINCT FROM ((1, 2), (3, 4), 5))
);

CREATE VIEW s.v AS SELECT a FROM s.t
  WHERE ((a, b), (c, d), e) IS DISTINCT FROM ((1, 2), (3, 4), 5);
