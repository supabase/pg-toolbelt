CREATE ROLE reader NOLOGIN;
CREATE TABLE public.products (
  id serial PRIMARY KEY,
  name text NOT NULL DEFAULT '',
  price_cents int NOT NULL DEFAULT 0
);
CREATE VIEW public.cheap_products AS SELECT id, name FROM public.products WHERE price_cents < 1000;
CREATE FUNCTION public.product_count() RETURNS bigint LANGUAGE sql STABLE
  AS $$ SELECT count(*) FROM public.products $$;
GRANT SELECT ON public.products, public.cheap_products TO reader;
