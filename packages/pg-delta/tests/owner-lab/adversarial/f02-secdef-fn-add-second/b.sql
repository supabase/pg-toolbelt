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
GRANT UPDATE ON public.accounts TO api_definer;
CREATE FUNCTION api.get_balance(p_account uuid) RETURNS numeric
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT balance FROM public.accounts WHERE id = p_account $$;
REVOKE EXECUTE ON FUNCTION api.get_balance(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.get_balance(uuid) TO app_user;
CREATE FUNCTION api.transfer(p_from uuid, p_to uuid, p_amount numeric) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
  AS $$
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive';
  END IF;
  UPDATE public.accounts SET balance = balance - p_amount WHERE id = p_from;
  UPDATE public.accounts SET balance = balance + p_amount WHERE id = p_to;
END
$$;
REVOKE EXECUTE ON FUNCTION api.transfer(uuid, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.transfer(uuid, uuid, numeric) TO app_user;
GRANT api_definer TO current_user;
GRANT CREATE ON SCHEMA api TO api_definer;
ALTER FUNCTION api.get_balance(uuid) OWNER TO api_definer;
ALTER FUNCTION api.transfer(uuid, uuid, numeric) OWNER TO api_definer;
REVOKE CREATE ON SCHEMA api FROM api_definer;
REVOKE api_definer FROM current_user;
