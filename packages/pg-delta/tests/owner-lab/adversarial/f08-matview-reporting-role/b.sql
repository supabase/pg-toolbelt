CREATE ROLE app_owner NOLOGIN;
CREATE ROLE reporting_owner NOLOGIN;
CREATE ROLE analyst NOLOGIN;
CREATE SCHEMA app;
GRANT USAGE, CREATE ON SCHEMA app TO app_owner;
GRANT USAGE ON SCHEMA app TO reporting_owner;
GRANT app_owner TO current_user;
GRANT reporting_owner TO current_user;
CREATE SCHEMA reporting AUTHORIZATION reporting_owner;
SET ROLE app_owner;
CREATE TABLE app.orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.order_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id bigint REFERENCES app.orders (id),
  qty int NOT NULL DEFAULT 1,
  price_cents bigint NOT NULL DEFAULT 0
);
GRANT SELECT ON app.orders, app.order_items TO reporting_owner;
RESET ROLE;
SET ROLE reporting_owner;
CREATE MATERIALIZED VIEW reporting.daily_revenue AS
  SELECT date_trunc('day', o.created_at) AS day, sum(i.qty * i.price_cents) AS revenue_cents,
         count(DISTINCT o.id) AS orders
  FROM app.orders o JOIN app.order_items i ON i.order_id = o.id
  GROUP BY 1;
CREATE UNIQUE INDEX daily_revenue_day_idx ON reporting.daily_revenue (day);
GRANT USAGE ON SCHEMA reporting TO analyst;
GRANT SELECT ON reporting.daily_revenue TO analyst;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM app_owner;
REVOKE app_owner FROM current_user;
REVOKE reporting_owner FROM current_user;
