create table public.comments (
  id bigint generated always as identity primary key,
  post_id bigint not null references public.posts (id) on delete cascade,
  body text not null
);
