CREATE ROLE app_owner NOLOGIN;
CREATE SCHEMA app;
GRANT USAGE, CREATE ON SCHEMA app TO app_owner;
GRANT app_owner TO current_user;
SET ROLE app_owner;
CREATE TYPE app.order_status AS ENUM ('pending', 'paid', 'shipped');
CREATE TABLE app.orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  status app.order_status NOT NULL DEFAULT 'pending'
);
ALTER TYPE app.order_status ADD VALUE 'cancelled' BEFORE 'shipped';
ALTER TYPE app.order_status ADD VALUE 'refunded';
-- the new values must be committed before use
COMMIT;
ALTER TABLE app.orders ADD COLUMN refunded_at timestamptz;
CREATE INDEX orders_refunded_idx ON app.orders (refunded_at) WHERE status = 'refunded';
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM app_owner;
REVOKE app_owner FROM current_user;
