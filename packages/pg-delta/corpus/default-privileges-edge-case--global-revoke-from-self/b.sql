-- state B: a global default-privilege revoke from the role itself
CREATE ROLE corpus_dp_writer NOLOGIN;
ALTER DEFAULT PRIVILEGES FOR ROLE corpus_dp_writer
  REVOKE SELECT, INSERT ON TABLES FROM corpus_dp_writer;
