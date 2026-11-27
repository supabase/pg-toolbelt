CREATE ROLE corpus_rn_writer NOLOGIN;
CREATE SCHEMA app;
ALTER SCHEMA app OWNER TO corpus_rn_writer;
CREATE TABLE app.t0_r (id int);
