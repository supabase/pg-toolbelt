create role app_owner nologin;
create table public.profiles (id uuid primary key, email text);
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin insert into public.profiles (id, email) values (new.id, new.email); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
grant create on schema public to app_owner;
grant app_owner to postgres;
alter function public.handle_new_user() owner to app_owner;
alter table public.profiles owner to app_owner;
revoke execute on function public.handle_new_user() from anon, authenticated, public;
revoke app_owner from postgres;
revoke create on schema public from app_owner;
