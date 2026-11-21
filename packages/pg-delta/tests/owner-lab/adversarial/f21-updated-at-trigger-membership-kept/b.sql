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
CREATE FUNCTION public.handle_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER projects_updated_at BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER tasks_updated_at BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE INDEX tasks_project_id_idx ON public.tasks (project_id);
