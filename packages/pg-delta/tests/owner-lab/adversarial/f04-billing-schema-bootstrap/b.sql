CREATE ROLE app_reader NOLOGIN;
CREATE ROLE billing_owner NOLOGIN;
GRANT billing_owner TO current_user;
CREATE SCHEMA billing AUTHORIZATION billing_owner;
SET ROLE billing_owner;
CREATE TYPE billing.invoice_status AS ENUM ('draft', 'open', 'paid', 'void');
CREATE SEQUENCE billing.invoice_number_seq START 1000;
CREATE TABLE billing.customers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE billing.invoices (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  number bigint NOT NULL DEFAULT nextval('billing.invoice_number_seq'),
  customer_id bigint NOT NULL REFERENCES billing.customers (id) ON DELETE CASCADE,
  status billing.invoice_status NOT NULL DEFAULT 'draft',
  total_cents bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invoices_customer_id_idx ON billing.invoices (customer_id);
CREATE INDEX invoices_open_idx ON billing.invoices (status) WHERE status <> 'void';
CREATE FUNCTION billing.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER invoices_touch_updated_at BEFORE UPDATE ON billing.invoices
  FOR EACH ROW EXECUTE FUNCTION billing.touch_updated_at();
CREATE VIEW billing.open_invoices AS
  SELECT i.id, i.number, c.email, i.total_cents
  FROM billing.invoices i JOIN billing.customers c ON c.id = i.customer_id
  WHERE i.status = 'open';
GRANT USAGE ON SCHEMA billing TO app_reader;
GRANT SELECT ON billing.open_invoices TO app_reader;
RESET ROLE;
REVOKE billing_owner FROM current_user;
