create role app_owner nologin;
create table public.msgs (id bigint primary key, body text);
grant create on schema public to app_owner;
grant app_owner to postgres;
alter table public.msgs owner to app_owner;
revoke app_owner from postgres;
revoke create on schema public from app_owner;
