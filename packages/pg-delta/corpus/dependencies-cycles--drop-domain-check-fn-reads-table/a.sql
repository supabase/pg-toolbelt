-- A column's domain CHECK calls a function whose body reads the column's own
-- table. The loop back into the table runs through the domain's CHECK (a
-- folded child of the domain), while the column depends on the domain itself,
-- so the column drop must not fold into DROP TABLE.
CREATE TABLE public.t (id integer PRIMARY KEY);

CREATE FUNCTION public.g(x integer) RETURNS boolean LANGUAGE sql IMMUTABLE
BEGIN ATOMIC
  SELECT x >= (SELECT count(*)::integer FROM public.t WHERE false);
END;

CREATE DOMAIN public.d AS integer CHECK (public.g(VALUE));

ALTER TABLE public.t ADD COLUMN c public.d;
