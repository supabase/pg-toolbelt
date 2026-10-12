-- The table is REPLACED (heap -> partitioned) and one of its foreign keys goes
-- away. FK drops never fold, so the explicit DROP CONSTRAINT targets the old
-- table and must run before the table's DROP, not after its re-CREATE.
CREATE TABLE public.parent (id integer PRIMARY KEY);

CREATE TABLE public.child (
  id integer NOT NULL DEFAULT 0,
  parent_id integer REFERENCES public.parent (id)
);
