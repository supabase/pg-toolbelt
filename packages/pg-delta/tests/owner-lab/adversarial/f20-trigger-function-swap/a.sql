CREATE ROLE app_owner NOLOGIN;
CREATE SCHEMA app;
GRANT USAGE, CREATE ON SCHEMA app TO app_owner;
GRANT app_owner TO current_user;
SET ROLE app_owner;
CREATE TABLE app.posts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title text NOT NULL DEFAULT '',
  slug text,
  updated_at timestamptz
);
CREATE FUNCTION app.posts_before_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.slug := lower(replace(NEW.title, ' ', '-'));
  RETURN NEW;
END
$$;
CREATE TRIGGER posts_before_write BEFORE INSERT OR UPDATE ON app.posts
  FOR EACH ROW EXECUTE FUNCTION app.posts_before_write();
RESET ROLE;
REVOKE app_owner FROM current_user;
