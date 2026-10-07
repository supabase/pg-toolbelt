create table public.tt (a int, b int, c int);

create function public.tf() returns trigger language plpgsql as $$
begin
  return new;
end
$$;

create trigger t after update on public.tt for each row
  when ((old.a, old.b, old.c) is distinct from (new.a, new.b, new.c))
  execute function public.tf();
