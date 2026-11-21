CREATE ROLE app_owner NOLOGIN;
CREATE SCHEMA app;
GRANT USAGE, CREATE ON SCHEMA app TO app_owner;
GRANT app_owner TO current_user;
SET ROLE app_owner;
CREATE TABLE app.organizations (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text);
CREATE TABLE app.memberships (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id bigint REFERENCES app.organizations (id),
  user_id uuid NOT NULL DEFAULT gen_random_uuid(),
  role text DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  CONSTRAINT memberships_user_id_key UNIQUE (user_id)
);
RESET ROLE;
REVOKE app_owner FROM current_user;
