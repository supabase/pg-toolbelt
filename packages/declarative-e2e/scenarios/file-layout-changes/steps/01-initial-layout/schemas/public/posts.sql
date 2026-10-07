create table public.posts (
  id bigint generated always as identity primary key,
  author_id uuid not null,
  title text not null
);

alter table public.posts enable row level security;
