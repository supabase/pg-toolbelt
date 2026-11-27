-- state A: the applying role has a default privilege for a reader
CREATE ROLE corpus_dp_owner NOLOGIN;
CREATE ROLE corpus_dp_reader NOLOGIN;
ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO corpus_dp_reader;
