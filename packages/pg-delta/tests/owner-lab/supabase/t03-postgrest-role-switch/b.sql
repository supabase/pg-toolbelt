create role app_role nologin;
grant app_role to authenticator;
grant usage on schema public to app_role;
create table public.t3 (id int primary key);
grant select on public.t3 to app_role;
