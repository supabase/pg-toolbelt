grant create on schema public to authenticated;
create function public.owned_by_authenticated() returns int language sql as $$ select 1 $$;
alter function public.owned_by_authenticated() owner to authenticated;
revoke create on schema public from authenticated;
