-- The table is REPLACED (heap -> partitioned), the expression index goes away,
-- and the row-type function stays. The function is rebuilt with the table, so
-- its drop is a replace action: the index must still drop before it.
CREATE TABLE public.bookings (
  id integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'
);

CREATE FUNCTION public.booking_priority(b public.bookings)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT length(b.status)
$$;

CREATE INDEX bookings_priority ON public.bookings (public.booking_priority(bookings));
