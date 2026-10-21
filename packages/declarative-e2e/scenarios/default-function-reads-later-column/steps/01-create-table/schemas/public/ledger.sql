-- `a`'s DEFAULT runs public.entry_count() when the column is added, and that
-- function reads `b`, which is declared after `a`.
create function public.entry_count() returns integer
  language plpgsql stable
  as $$ begin return (select count(b) from public.ledger); end $$;

create table public.ledger (
  id bigint primary key,
  a integer default public.entry_count(),
  b integer
);
