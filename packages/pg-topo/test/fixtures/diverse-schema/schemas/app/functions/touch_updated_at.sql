create function app.touch_updated_at() returns trigger
    language plpgsql
as $$
begin
    new.updated_at = timezone('utc', now());
    return new;
end;
$$;
