grant create on schema public to supabase_auth_admin;
create function public.owned_by_auth_admin() returns int language sql as $$ select 1 $$;
alter function public.owned_by_auth_admin() owner to supabase_auth_admin;
revoke create on schema public from supabase_auth_admin;
