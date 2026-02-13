create event trigger app_ddl_watch
    on ddl_command_end
execute function app.on_ddl_command_end();
