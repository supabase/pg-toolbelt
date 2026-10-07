-- Declarative ahead: a hand-written migration history. Postgres keeps these
-- expansions nested (BETWEEN or a row comparison on the left of the same
-- AND/OR, nested rows one level per parse), a tree no SQL text parses back
-- into. `generate` exports their printouts, which load flatter, so the
-- bootstrap re-sync compares a once-parsed target with a twice-parsed shadow.
create table public.p (
  a int,
  b int,
  constraint p_check check (b between 0 and 10 and a >= 0)
);
alter table public.p enable row level security;
create policy p_sel on public.p for select using (b between 0 and 10 and a >= 0);
create index p_idx on public.p (a) where b between 0 and 10 and a >= 0;
create view public.pv as select a from public.p where b between 0 and 10 and a >= 0;

create table public.tt (a int, b int, c int);
create function public.tf() returns trigger language plpgsql as $$
begin
  return new;
end
$$;
create trigger t after update on public.tt for each row
  when ((old.a, old.b, old.c) is distinct from (new.a, new.b, new.c))
  execute function public.tf();

create table public.nr (
  a int,
  b int,
  c int,
  d int,
  e int,
  constraint nr_check check (((a, b), (c, d), e) is distinct from ((1, 2), (3, 4), 5))
);
