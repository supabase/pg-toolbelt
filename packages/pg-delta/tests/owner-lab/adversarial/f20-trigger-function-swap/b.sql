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
CREATE FUNCTION app.slugify(p text) RETURNS text LANGUAGE sql IMMUTABLE
  AS $$ SELECT trim(both '-' from regexp_replace(lower(p), '[^a-z0-9]+', '-', 'g')) $$;
CREATE FUNCTION app.set_slug() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.slug := app.slugify(NEW.title);
  RETURN NEW;
END
$$;
CREATE FUNCTION app.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER posts_set_slug BEFORE INSERT OR UPDATE OF title ON app.posts
  FOR EACH ROW EXECUTE FUNCTION app.set_slug();
CREATE TRIGGER posts_set_updated_at BEFORE UPDATE ON app.posts
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
RESET ROLE;
REVOKE app_owner FROM current_user;
