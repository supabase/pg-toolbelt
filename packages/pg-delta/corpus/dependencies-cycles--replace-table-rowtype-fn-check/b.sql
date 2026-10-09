CREATE TABLE public.bookings (
  id integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'
) PARTITION BY RANGE (id);

CREATE TABLE public.bookings_default PARTITION OF public.bookings DEFAULT;
