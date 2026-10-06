create table public.orders (
  id bigint generated always as identity primary key,
  amount bigint not null,
  note text
);
