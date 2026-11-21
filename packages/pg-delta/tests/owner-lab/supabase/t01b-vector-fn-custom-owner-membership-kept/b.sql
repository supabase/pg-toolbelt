create extension if not exists vector with schema extensions;
create role app_owner nologin;
create function public.match_docs(q extensions.vector, k int) returns int language sql stable as $$ select k $$;
grant create on schema public to app_owner;
grant app_owner to postgres;
alter function public.match_docs(extensions.vector, int) owner to app_owner;
revoke execute on function public.match_docs(extensions.vector, int) from anon;
revoke execute on function public.match_docs(extensions.vector, int) from public;
revoke create on schema public from app_owner;
