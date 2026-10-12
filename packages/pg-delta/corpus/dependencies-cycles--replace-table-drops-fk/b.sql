CREATE TABLE public.parent (id integer PRIMARY KEY);

CREATE TABLE public.child (
  id integer NOT NULL DEFAULT 0,
  parent_id integer
) PARTITION BY RANGE (id);

CREATE TABLE public.child_default PARTITION OF public.child DEFAULT;
