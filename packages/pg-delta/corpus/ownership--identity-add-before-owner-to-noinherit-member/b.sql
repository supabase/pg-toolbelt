-- Applied as a CREATEROLE non-superuser that can SET ROLE to the new owner
-- but does not inherit it: past OWNER TO it no longer owns the table, so the
-- identity add must run first.
CREATE ROLE id_owner NOLOGIN;
GRANT id_owner TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;
CREATE SCHEMA app;
GRANT CREATE ON SCHEMA app TO id_owner;
CREATE TABLE app.t (id int PRIMARY KEY, n int NOT NULL GENERATED ALWAYS AS IDENTITY);
-- lets the applier read the table back for the data proof
GRANT SELECT ON app.t TO PUBLIC;
ALTER TABLE app.t OWNER TO id_owner;
