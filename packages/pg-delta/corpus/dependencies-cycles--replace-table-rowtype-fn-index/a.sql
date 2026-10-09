-- An index expression calls a function that takes the table's row type, and the
-- table is REPLACED (heap -> partitioned) while the function and the index go
-- away. The explicit index drop targets the OLD table, so it must run before
-- the table's DROP, not after its re-CREATE.
CREATE TABLE public.bookings (
  id integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'
);

CREATE FUNCTION public.booking_priority(b public.bookings)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT length(b.status)
$$;

CREATE INDEX bookings_priority ON public.bookings (public.booking_priority(bookings));
