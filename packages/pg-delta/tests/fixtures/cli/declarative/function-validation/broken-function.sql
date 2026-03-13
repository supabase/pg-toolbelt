CREATE FUNCTION public.broken_users_count()
RETURNS integer
LANGUAGE sql
AS $$
  SELECT count(*)::integer FROM public.missing_users;
$$;
