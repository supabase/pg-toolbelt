-- platform-owned auth schema (like Supabase auth.users): created by the cluster
-- superuser, the migration role holds privileges on it but no membership/ADMIN
CREATE ROLE auth_admin NOLOGIN;
CREATE SCHEMA auth AUTHORIZATION auth_admin;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb
);
ALTER TABLE auth.users OWNER TO auth_admin;
GRANT USAGE ON SCHEMA auth TO lab_applier;
GRANT SELECT, REFERENCES, TRIGGER ON auth.users TO lab_applier;
