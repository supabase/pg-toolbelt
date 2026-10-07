create table public.todos (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid(),
  title text not null,
  is_public boolean not null default false
);

alter table public.todos enable row level security;

create policy "read own todos" on public.todos
  for select to authenticated using (is_public or (select auth.uid()) = user_id);
