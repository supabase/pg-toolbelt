create table public.profiles (
  id uuid not null references auth.users (id) on delete cascade,
  full_name text,
  avatar_url text,
  website text,
  primary key (id)
);

alter table public.profiles enable row level security;

create policy "Public profiles are viewable by everyone." on public.profiles
  for select using (true);

create policy "Users can insert their own profile." on public.profiles
  for insert with check ((select auth.uid()) = id);

create policy "Users can update own profile." on public.profiles
  for update using ((select auth.uid()) = id);

grant all on table public.profiles to anon, authenticated, service_role;
