-- state B: t predates the default privilege, so the reader holds nothing on it.
-- The plan creates t as the applying role (whose default privilege grants the
-- reader SELECT) and then moves it to another owner, which keeps that entry.
CREATE ROLE corpus_dp_owner NOLOGIN;
CREATE ROLE corpus_dp_reader NOLOGIN;
CREATE TABLE t (id bigint);
ALTER TABLE t OWNER TO corpus_dp_owner;
ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO corpus_dp_reader;
