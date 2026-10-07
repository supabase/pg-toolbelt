create table public.customers (
  id bigint primary key,
  name text not null,
  email text
);

grant all on table public.customers to anon, authenticated, service_role;
