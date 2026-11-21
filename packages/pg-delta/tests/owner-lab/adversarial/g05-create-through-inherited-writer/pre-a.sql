CREATE ROLE app_owner NOLOGIN;
CREATE ROLE app_writer NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
GRANT app_writer TO lab_applier;
DO $$ BEGIN IF current_setting('server_version_num')::int >= 160000 THEN EXECUTE 'GRANT app_owner TO lab_applier WITH ADMIN TRUE, INHERIT FALSE, SET FALSE'; END IF; END $$;
