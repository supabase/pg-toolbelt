create function app.on_ddl_command_end() returns event_trigger
    language plpgsql
as $$
begin
    perform 1;
end;
$$;
