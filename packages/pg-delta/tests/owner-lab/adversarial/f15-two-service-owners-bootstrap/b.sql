CREATE ROLE authenticated NOLOGIN;
CREATE ROLE auth_admin NOLOGIN;
CREATE ROLE storage_admin NOLOGIN;
GRANT auth_admin TO current_user;
GRANT storage_admin TO current_user;
CREATE SCHEMA auth AUTHORIZATION auth_admin;
CREATE SCHEMA storage AUTHORIZATION storage_admin;
SET ROLE auth_admin;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated, storage_admin;
GRANT REFERENCES ON auth.users TO storage_admin;
RESET ROLE;
SET ROLE storage_admin;
CREATE TABLE storage.buckets (
  id text PRIMARY KEY,
  name text,
  public boolean NOT NULL DEFAULT false,
  owner uuid REFERENCES auth.users (id)
);
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets (id),
  name text,
  owner uuid REFERENCES auth.users (id),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX objects_bucket_id_name_idx ON storage.objects (bucket_id, name);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE POLICY objects_owner ON storage.objects FOR ALL TO authenticated
  USING (owner = auth.uid()) WITH CHECK (owner = auth.uid());
GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
GRANT SELECT ON storage.buckets TO authenticated;
RESET ROLE;
REVOKE auth_admin FROM current_user;
REVOKE storage_admin FROM current_user;
