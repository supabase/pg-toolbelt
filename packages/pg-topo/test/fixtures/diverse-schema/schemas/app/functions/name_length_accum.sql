create function app.name_length_accum(state bigint, value text) returns bigint
    language sql
    immutable
as $$
    select state + coalesce(length(value), 0)::bigint;
$$;
