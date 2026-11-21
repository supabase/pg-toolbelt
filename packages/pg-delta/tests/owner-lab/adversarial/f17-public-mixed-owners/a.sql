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
RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM stripe_sync;
REVOKE stripe_sync FROM current_user;
