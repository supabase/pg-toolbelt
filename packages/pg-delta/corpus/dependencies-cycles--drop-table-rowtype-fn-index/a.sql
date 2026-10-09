-- An index expression calls a function that takes the table's row type. The
-- index drop must not fold into DROP TABLE: the function depends on the row
-- type (drop before the table) and the index depends on the function.
CREATE TYPE public.booking_status AS ENUM ('pending', 'confirmed');

CREATE TABLE public.bookings (
  id integer PRIMARY KEY,
  status public.booking_status NOT NULL DEFAULT 'pending'
);

CREATE FUNCTION public.booking_priority(b public.bookings)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE b.status WHEN 'pending' THEN 0 ELSE 1 END
$$;

CREATE INDEX bookings_priority ON public.bookings (public.booking_priority(bookings));
