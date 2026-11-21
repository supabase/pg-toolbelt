create schema legal_api;
create function legal_api.legal_public_page_v1(slug text) returns text
  language sql security invoker as $$ select slug $$;
