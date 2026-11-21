CREATE ROLE app_user NOLOGIN;
CREATE ROLE api_definer NOLOGIN;
CREATE SCHEMA api;
GRANT USAGE ON SCHEMA api TO app_user, api_definer;
CREATE TABLE public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid,
  balance numeric NOT NULL DEFAULT 0
);
GRANT SELECT ON public.accounts TO api_definer;
CREATE FUNCTION api.get_balance(p_account uuid, p_include_pending boolean DEFAULT false) RETURNS numeric
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT balance FROM public.accounts WHERE id = p_account AND (p_include_pending OR owner_id IS NOT NULL) $$;
REVOKE EXECUTE ON FUNCTION api.get_balance(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_balance(uuid, boolean) TO app_user;
GRANT api_definer TO current_user;
GRANT CREATE ON SCHEMA api TO api_definer;
ALTER FUNCTION api.get_balance(uuid, boolean) OWNER TO api_definer;
REVOKE CREATE ON SCHEMA api FROM api_definer;
REVOKE api_definer FROM current_user;
