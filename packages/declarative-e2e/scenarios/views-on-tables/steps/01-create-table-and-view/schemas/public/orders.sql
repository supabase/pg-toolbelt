create table public.orders (
  id bigint generated always as identity primary key,
  amount integer not null,
  note text
);
