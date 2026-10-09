-- A CHECK constraint calls a function that takes the table's row type. The
-- constraint drop must not fold into DROP TABLE (see the -index sibling).
CREATE TYPE public.booking_status AS ENUM ('pending', 'confirmed');

CREATE TABLE public.bookings (
  id integer PRIMARY KEY,
  status public.booking_status NOT NULL DEFAULT 'pending'
);

CREATE FUNCTION public.booking_priority(b public.bookings)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE b.status WHEN 'pending' THEN 0 ELSE 1 END
$$;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_priority_chk CHECK (public.booking_priority(bookings) >= 0);
