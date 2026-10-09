-- Production shape: a branch drops a table, the row-type helper its CHECK
-- calls, its trigger functions (some in a dropped schema), an extension used
-- by a trigger, and the enum types of its columns, all in one plan.
CREATE SCHEMA private;
CREATE EXTENSION moddatetime SCHEMA private;

CREATE TYPE public.org_status AS ENUM ('active', 'suspended');
CREATE TYPE public.org_type AS ENUM ('team', 'personal');

CREATE TABLE public.organizations (
  id integer PRIMARY KEY,
  status public.org_status NOT NULL DEFAULT 'active',
  type public.org_type NOT NULL DEFAULT 'team',
  billing_email text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE private.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  row_data jsonb NOT NULL
);

CREATE FUNCTION public.org_can_be_billed(o public.organizations)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT o.billing_email IS NOT NULL
$$;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_billable
  CHECK (status <> 'active' OR public.org_can_be_billed(organizations));

CREATE FUNCTION private.audit_trigger_func()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO private.audit_log (row_data) VALUES (to_jsonb(NEW));
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.protect_organization_fields()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.type := OLD.type;
  RETURN NEW;
END;
$$;

CREATE TRIGGER organizations_audit
  AFTER INSERT OR UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION private.audit_trigger_func();

CREATE TRIGGER organizations_protect
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.protect_organization_fields();

CREATE TRIGGER organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION private.moddatetime(updated_at);
