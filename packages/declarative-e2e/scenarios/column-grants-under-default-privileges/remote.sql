create table public.probe (id integer primary key, public_value text, display_name text);
revoke all on table public.probe from anon;
grant select (public_value) on table public.probe to anon;
alter table public.probe enable row level security;
create view public.probe_v as select id, public_value from public.probe;
revoke all on public.probe_v from anon;
grant select (public_value) on public.probe_v to anon;
