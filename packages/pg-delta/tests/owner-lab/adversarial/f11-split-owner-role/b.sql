CREATE ROLE billing_owner NOLOGIN;
CREATE ROLE app_owner NOLOGIN;
CREATE SCHEMA app;
GRANT USAGE, CREATE ON SCHEMA app TO app_owner;
-- granted by hand once, kept
GRANT app_owner TO current_user;
SET ROLE app_owner;
CREATE TABLE app.users (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, email text);
CREATE TABLE app.orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint REFERENCES app.users (id),
  total_cents bigint NOT NULL DEFAULT 0
);
CREATE TABLE app.invoices (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id bigint REFERENCES app.orders (id),
  issued_at timestamptz DEFAULT now()
);
CREATE TABLE app.payments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id bigint REFERENCES app.invoices (id),
  amount_cents bigint NOT NULL DEFAULT 0
);
CREATE FUNCTION app.invoice_paid_cents(p_invoice bigint) RETURNS bigint LANGUAGE sql STABLE
  AS $$ SELECT coalesce(sum(amount_cents), 0)::bigint FROM app.payments WHERE invoice_id = p_invoice $$;
GRANT SELECT, REFERENCES ON app.orders TO billing_owner;
RESET ROLE;
GRANT USAGE ON SCHEMA app TO billing_owner;
GRANT billing_owner TO current_user;
GRANT CREATE ON SCHEMA app TO billing_owner;
ALTER TABLE app.invoices OWNER TO billing_owner;
ALTER TABLE app.payments OWNER TO billing_owner;
ALTER FUNCTION app.invoice_paid_cents(bigint) OWNER TO billing_owner;
REVOKE CREATE ON SCHEMA app FROM billing_owner;
REVOKE billing_owner FROM current_user;
