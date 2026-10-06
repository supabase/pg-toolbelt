create table public.customers (
  id bigint primary key,
  name text not null
);

insert into public.customers (id, name) values (1, 'ada'), (2, 'grace'), (3, 'linus');
