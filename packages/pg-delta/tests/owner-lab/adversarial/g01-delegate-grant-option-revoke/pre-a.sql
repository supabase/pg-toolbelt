CREATE ROLE app_owner NOLOGIN;
CREATE ROLE acl_team NOLOGIN;
CREATE ROLE acl_delegate NOLOGIN;
CREATE ROLE reader NOLOGIN;
GRANT acl_team TO lab_applier;
GRANT acl_delegate TO acl_team;
DO $$ BEGIN IF current_setting('server_version_num')::int >= 160000 THEN EXECUTE 'GRANT app_owner TO lab_applier WITH ADMIN TRUE, INHERIT FALSE, SET FALSE'; END IF; END $$;
