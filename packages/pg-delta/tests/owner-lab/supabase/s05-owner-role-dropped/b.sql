create function public.f() returns int language sql as $$ select 1 $$;
create table public.t (id int primary key);
