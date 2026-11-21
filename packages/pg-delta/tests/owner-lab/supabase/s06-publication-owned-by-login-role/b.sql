create table public.items (id int primary key);
create role preview_user login password 'x';
grant create on database postgres to preview_user;
create publication electric_publication_default for table public.items;
grant preview_user to postgres;
alter publication electric_publication_default owner to preview_user;
revoke preview_user from postgres;
