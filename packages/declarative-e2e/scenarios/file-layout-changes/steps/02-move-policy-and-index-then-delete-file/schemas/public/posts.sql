create table public.posts (
  id bigint generated always as identity primary key,
  author_id uuid not null,
  title text not null
);

create index posts_author_id_idx on public.posts (author_id);

alter table public.posts enable row level security;

create policy "authors read posts" on public.posts
  for select to authenticated using ((select auth.uid()) = author_id);
