-- Row-comparison spelling of a.sql (issue #510). Postgres stores a 3+-column
-- row IS [NOT] DISTINCT FROM as nested ORs, deparsed as ((A OR B) OR C) but
-- re-parsed flat, so it settles to a.sql's text once replayed: the a -> b plan
-- must be empty instead of rebuilding these objects on every run.
CREATE SCHEMA s;

CREATE FUNCTION s.tf() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NEW; END$$;

CREATE DOMAIN s.dm AS int CHECK ((VALUE, VALUE, VALUE) IS DISTINCT FROM (1, 2, 3));
CREATE DOMAIN s.dm_default AS boolean
  DEFAULT ((length(current_user::text), 2, 3) IS DISTINCT FROM (1, 2, 3));

CREATE TABLE s.t (
  a int,
  b int,
  c int,
  g boolean GENERATED ALWAYS AS ((a, b, c) IS DISTINCT FROM (1, 2, 3)) STORED,
  d boolean DEFAULT ((length(current_user::text), 2, 3) IS DISTINCT FROM (1, 2, 3)),
  CONSTRAINT ck CHECK ((a, b, c) IS DISTINCT FROM (1, 2, 3)),
  CONSTRAINT ck_not CHECK ((a, b, c) IS NOT DISTINCT FROM (a, b, c))
);

CREATE INDEX ix_pred ON s.t (a) WHERE (a, b, c) IS DISTINCT FROM (1, 2, 3);
CREATE INDEX ix_expr ON s.t ((((a, b, c) IS DISTINCT FROM (1, 2, 3))));

CREATE VIEW s.v AS SELECT a FROM s.t WHERE (a, b, c) IS DISTINCT FROM (1, 2, 3);
CREATE MATERIALIZED VIEW s.mv AS
  SELECT a FROM s.t WHERE (a, b, c) IS DISTINCT FROM (1, 2, 3);

ALTER TABLE s.t ENABLE ROW LEVEL SECURITY;
CREATE POLICY p ON s.t
  USING ((a, b, c) IS DISTINCT FROM (1, 2, 3))
  WITH CHECK ((a, b, c) IS DISTINCT FROM (1, 2, 3));

CREATE TABLE s.r (a int, b int, c int);
CREATE TABLE s.rlog (n int);
CREATE RULE ru AS ON UPDATE TO s.r
  WHERE (old.a, old.b, old.c) IS DISTINCT FROM (new.a, new.b, new.c)
  DO ALSO INSERT INTO s.rlog VALUES (1);
CREATE TRIGGER tg AFTER UPDATE ON s.r FOR EACH ROW
  WHEN ((OLD.a, OLD.b, OLD.c) IS DISTINCT FROM (NEW.a, NEW.b, NEW.c))
  EXECUTE FUNCTION s.tf();

CREATE FUNCTION s.fs(a int, b int, c int) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  RETURN (a, b, c) IS DISTINCT FROM (1, 2, 3);
