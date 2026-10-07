-- `_custom/` SQL is not migrated, so the target gets the configuration directly.
create text search configuration public.english_simple (copy = pg_catalog.english);

create table public.articles (
  id bigint primary key,
  body text not null
);
