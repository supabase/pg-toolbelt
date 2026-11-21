CREATE ROLE app_owner NOLOGIN;
CREATE TABLE public.notes (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, body text);
GRANT SELECT ON public.notes TO app_owner;
GRANT CREATE ON SCHEMA public TO app_owner;
GRANT app_owner TO current_user;
SET ROLE app_owner;
CREATE FUNCTION public.note_count() RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT count(*) FROM public.notes $$;
CREATE FUNCTION public.current_user_id() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION public.normalize_email(p text) RETURNS text LANGUAGE sql IMMUTABLE
  AS $$ SELECT lower(trim(p)) $$;
RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM app_owner;
REVOKE app_owner FROM current_user;
