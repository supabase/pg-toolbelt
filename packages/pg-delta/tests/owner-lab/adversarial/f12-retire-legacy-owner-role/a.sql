CREATE ROLE legacy_owner NOLOGIN;
CREATE ROLE reader NOLOGIN;
GRANT CREATE ON SCHEMA public TO legacy_owner;
GRANT legacy_owner TO current_user;
SET ROLE legacy_owner;
CREATE TABLE public.products (
  id serial PRIMARY KEY,
  name text NOT NULL DEFAULT '',
  price_cents int NOT NULL DEFAULT 0
);
CREATE VIEW public.cheap_products AS SELECT id, name FROM public.products WHERE price_cents < 1000;
CREATE FUNCTION public.product_count() RETURNS bigint LANGUAGE sql STABLE
  AS $$ SELECT count(*) FROM public.products $$;
GRANT SELECT ON public.products, public.cheap_products TO reader;
RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM legacy_owner;
REVOKE legacy_owner FROM current_user;
