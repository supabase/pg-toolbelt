CREATE ROLE app_owner NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
GRANT CREATE ON SCHEMA public TO app_owner;
GRANT app_owner TO current_user;
SET ROLE app_owner;
CREATE TABLE public.settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT ON public.settings TO authenticated;
CREATE FUNCTION public.get_setting(p_key text) RETURNS jsonb LANGUAGE sql STABLE
  AS $$ SELECT value FROM public.settings WHERE key = p_key $$;
RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM app_owner;
REVOKE app_owner FROM current_user;
