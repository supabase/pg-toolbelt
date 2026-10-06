create table public.comments (
  id bigint generated always as identity primary key,
  post_id bigint not null references public.posts (id) on delete cascade,
  body text not null
);

create index comments_post_id_idx on public.comments (post_id);
