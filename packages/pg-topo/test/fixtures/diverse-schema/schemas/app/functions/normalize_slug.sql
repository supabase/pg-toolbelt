create function app.normalize_slug(input text) returns app.slug_text
    language sql
    immutable
as $$
    select lower(regexp_replace(input, '[^a-zA-Z0-9-]+', '-', 'g'))::app.slug_text;
$$;
