CREATE ROLE app_reader NOLOGIN;
CREATE ROLE app_owner NOLOGIN;
CREATE ROLE billing_owner NOLOGIN;
GRANT CREATE ON SCHEMA public TO app_owner;
GRANT app_owner TO current_user;
SET ROLE app_owner;
CREATE TABLE public.organizations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL DEFAULT ''
);
GRANT REFERENCES ON public.organizations TO billing_owner;
RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM app_owner;
REVOKE app_owner FROM current_user;
GRANT billing_owner TO current_user;
CREATE SCHEMA billing AUTHORIZATION billing_owner;
SET ROLE billing_owner;
CREATE TABLE billing.customers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE billing.invoices (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id bigint REFERENCES billing.customers (id),
  status text NOT NULL DEFAULT 'draft',
  total_cents bigint NOT NULL DEFAULT 0
);
CREATE INDEX invoices_customer_id_idx ON billing.invoices (customer_id);
GRANT USAGE ON SCHEMA billing TO app_reader;
GRANT SELECT ON billing.invoices TO app_reader;
ALTER TABLE billing.customers ADD COLUMN organization_id bigint REFERENCES public.organizations (id);
CREATE INDEX customers_organization_id_idx ON billing.customers (organization_id);
ALTER TABLE billing.invoices ADD COLUMN due_date date;
ALTER TABLE billing.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoices_reader ON billing.invoices FOR SELECT TO app_reader USING (status <> 'draft');
RESET ROLE;
REVOKE billing_owner FROM current_user;
