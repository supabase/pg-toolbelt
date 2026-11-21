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
ALTER TABLE app.notes ADD COLUMN archived_at timestamptz;
CREATE INDEX notes_created_at_idx ON app.notes (created_at);
RESET ROLE;
-- the other environment never had the hand grant
REVOKE app_owner FROM current_user;
