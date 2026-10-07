create table public.articles (
  id bigint primary key,
  body text not null,
  search tsvector generated always as (to_tsvector('public.english_simple'::regconfig, body)) stored
);

grant all on table public.articles to anon, authenticated, service_role;
