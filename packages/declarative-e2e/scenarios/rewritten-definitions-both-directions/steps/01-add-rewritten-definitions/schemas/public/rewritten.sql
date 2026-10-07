-- Migrations ahead: the schema files hold the nested spellings, and the target
-- stores the sync migration's printout of them, parsed once more.
create table public.r (
  a int,
  b int,
  c int,
  constraint r_check check (b between 0 and 10 and a >= 0),
  constraint r_nested check (((a, b), (c, a), b) is distinct from ((1, 2), (3, 4), 5))
);

create function public.rf() returns trigger language plpgsql as $$
begin
  return new;
end
$$;

create trigger rt after update on public.r for each row
  when ((old.a, old.b, old.c) is distinct from (new.a, new.b, new.c))
  execute function public.rf();
