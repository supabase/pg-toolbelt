create extension pg_trgm with schema extensions;

grant execute on function extensions.similarity(text, text) to authenticated;
