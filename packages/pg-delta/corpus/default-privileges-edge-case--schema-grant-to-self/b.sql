-- state B: a schema-level default privilege naming its own role as grantee.
-- It adds to the global entry rather than replacing it.
CREATE ROLE corpus_dp_writer NOLOGIN;
CREATE SCHEMA app;
ALTER DEFAULT PRIVILEGES FOR ROLE corpus_dp_writer IN SCHEMA app
  GRANT EXECUTE ON FUNCTIONS TO corpus_dp_writer;
