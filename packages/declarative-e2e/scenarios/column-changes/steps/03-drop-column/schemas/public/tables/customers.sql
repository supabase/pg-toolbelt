create table public.customers (
  id bigint primary key,
  name text not null,
  status text not null default 'active'
);

grant all on table public.customers to anon, authenticated, service_role;
