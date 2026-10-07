create table public.notes (
  id bigint generated always as identity primary key,
  title text not null,
  body text
);

revoke all on table public.notes from anon, authenticated;
