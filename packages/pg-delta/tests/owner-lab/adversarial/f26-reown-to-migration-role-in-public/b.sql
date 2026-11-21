CREATE ROLE app_owner NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE TABLE public.settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT ON public.settings TO authenticated;
CREATE FUNCTION public.get_setting(p_key text) RETURNS jsonb LANGUAGE sql STABLE
  AS $$ SELECT value FROM public.settings WHERE key = p_key $$;
