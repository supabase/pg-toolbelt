CREATE ROLE app_owner NOLOGIN;
GRANT CREATE ON SCHEMA public TO app_owner;
-- granted by hand once, kept
GRANT app_owner TO current_user;
SET ROLE app_owner;
CREATE TABLE public.projects (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.tasks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint REFERENCES public.projects (id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
RESET ROLE;
