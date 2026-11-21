alter default privileges in schema public grant select on tables to anon;
create table public.things (id bigint primary key, name text);
grant select on public.things to anon;
grant select, insert, update, delete on public.things to authenticated;
grant all on public.things to service_role;
