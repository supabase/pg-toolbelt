create schema legal_api;
create role legal_public_reader nologin;
grant usage on schema legal_api to anon, authenticated;
grant usage, create on schema legal_api to legal_public_reader;
create function legal_api.legal_public_page_v1(slug text) returns text
  language sql security definer as $$ select upper(slug) $$;
grant legal_public_reader to postgres;
alter function legal_api.legal_public_page_v1(text) owner to legal_public_reader;
revoke all on function legal_api.legal_public_page_v1(text) from public;
grant execute on function legal_api.legal_public_page_v1(text) to anon, authenticated;
