CREATE ROLE stripe_sync NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text UNIQUE,
  stripe_customer_id text
);
GRANT SELECT ON public.profiles TO authenticated;
GRANT CREATE ON SCHEMA public TO stripe_sync;
GRANT stripe_sync TO current_user;
SET ROLE stripe_sync;
CREATE TABLE public.subscriptions (
  id text PRIMARY KEY,
  customer_id text NOT NULL,
  status text NOT NULL,
  current_period_end timestamptz
);
CREATE INDEX subscriptions_customer_id_idx ON public.subscriptions (customer_id);
ALTER TABLE public.subscriptions ADD COLUMN cancel_at_period_end boolean NOT NULL DEFAULT false;
RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM stripe_sync;
REVOKE stripe_sync FROM current_user;
CREATE VIEW public.active_subscribers AS
  SELECT p.id, p.username, s.status, s.current_period_end
  FROM public.profiles p JOIN public.subscriptions s ON s.customer_id = p.stripe_customer_id
  WHERE s.status IN ('active', 'trialing');
GRANT SELECT ON public.active_subscribers TO authenticated;
CREATE FUNCTION public.is_subscribed(p_user uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
  AS $$ SELECT EXISTS (SELECT 1 FROM public.active_subscribers WHERE id = p_user) $$;
