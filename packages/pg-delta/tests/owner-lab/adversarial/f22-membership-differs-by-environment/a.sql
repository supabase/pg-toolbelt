CREATE ROLE app_owner NOLOGIN;
CREATE SCHEMA app;
GRANT USAGE, CREATE ON SCHEMA app TO app_owner;
GRANT app_owner TO current_user;
SET ROLE app_owner;
CREATE TABLE app.notes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  body text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
RESET ROLE;
-- this environment: someone ran GRANT app_owner TO <migration role> by hand and kept it
