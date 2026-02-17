create function app.slug_ok(input text) returns boolean
    language sql
    immutable
as $$
    select input ~ '^[a-z0-9-]+$';
$$;

comment on function app.slug_ok(text) is 'Validates project slug syntax';

alter function app.slug_ok(text) owner to app_owner;
grant execute on function app.slug_ok(text) to app_reader;
