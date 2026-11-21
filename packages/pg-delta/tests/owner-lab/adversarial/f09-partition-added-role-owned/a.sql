CREATE ROLE app_owner NOLOGIN;
GRANT CREATE ON SCHEMA public TO app_owner;
GRANT app_owner TO current_user;
SET ROLE app_owner;
CREATE TABLE public.events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  kind text NOT NULL DEFAULT 'view',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE TABLE public.events_2026_10 PARTITION OF public.events FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE public.events_2026_11 PARTITION OF public.events FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE INDEX events_created_at_idx ON public.events (created_at);
RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM app_owner;
REVOKE app_owner FROM current_user;
