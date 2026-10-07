create index posts_author_id_idx on public.posts (author_id);

create policy "authors read posts" on public.posts
  for select to authenticated using ((select auth.uid()) = author_id);
