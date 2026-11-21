CREATE ROLE app_owner NOLOGIN;
CREATE ROLE reader NOLOGIN;
GRANT app_owner TO current_user;
CREATE SCHEMA app AUTHORIZATION app_owner;
SET ROLE app_owner;
GRANT USAGE ON SCHEMA app TO reader;
CREATE TABLE app.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text);
GRANT SELECT ON app.users TO reader;
CREATE TABLE app.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid REFERENCES app.users (id) ON DELETE SET NULL,
  action text NOT NULL DEFAULT '',
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_user_id_idx ON app.audit_log (user_id);
GRANT SELECT ON app.audit_log TO reader;
COMMENT ON TABLE app.audit_log IS 'Append-only audit trail';
RESET ROLE;
REVOKE app_owner FROM current_user;
