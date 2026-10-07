create table public.items (
  id bigint generated always as identity primary key,
  name text not null,
  updated_at timestamptz not null default now()
);

create function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger items_touch_updated_at
  before update on public.items
  for each row execute function public.touch_updated_at();
