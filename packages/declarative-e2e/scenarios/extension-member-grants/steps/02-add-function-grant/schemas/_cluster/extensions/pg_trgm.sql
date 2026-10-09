create extension pg_trgm with schema extensions;

grant execute on function extensions.word_similarity(text, text) to service_role with grant option;
