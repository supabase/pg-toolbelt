CREATE ROLE app_owner NOLOGIN;
CREATE ROLE reader NOLOGIN;
CREATE SCHEMA app;
GRANT USAGE ON SCHEMA app TO reader;
GRANT USAGE, CREATE ON SCHEMA app TO app_owner;
GRANT app_owner TO current_user;
SET ROLE app_owner;
CREATE TABLE app.orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_email text,
  total_cents bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE VIEW app.order_summary AS SELECT id, total_cents, status, created_at FROM app.orders;
CREATE VIEW app.big_orders AS SELECT id, total_cents, status FROM app.order_summary WHERE total_cents > 100000;
GRANT SELECT ON app.order_summary, app.big_orders TO reader;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM app_owner;
REVOKE app_owner FROM current_user;
