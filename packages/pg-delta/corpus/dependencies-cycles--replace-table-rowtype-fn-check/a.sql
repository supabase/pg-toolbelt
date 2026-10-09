-- A CHECK constraint calls a function that takes the table's row type, and the
-- table is REPLACED (heap -> partitioned) while the function and the check go
-- away. The explicit check drop targets the OLD table, so it must run before
-- the table's DROP, not after its re-CREATE.
CREATE TABLE public.bookings (
  id integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'
);

CREATE FUNCTION public.booking_priority(b public.bookings)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT length(b.status)
$$;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_priority_chk CHECK (public.booking_priority(bookings) >= 0);
