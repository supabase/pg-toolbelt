CREATE ROLE app_owner NOLOGIN;
CREATE SCHEMA app;
GRANT USAGE, CREATE ON SCHEMA app TO app_owner;
GRANT app_owner TO current_user;
SET ROLE app_owner;
CREATE TABLE app.organizations (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name text);
CREATE TABLE app.memberships (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id bigint REFERENCES app.organizations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT gen_random_uuid(),
  role varchar(20) NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin', 'owner')),
  CONSTRAINT memberships_organization_id_user_id_key UNIQUE (organization_id, user_id)
);
RESET ROLE;
REVOKE app_owner FROM current_user;
