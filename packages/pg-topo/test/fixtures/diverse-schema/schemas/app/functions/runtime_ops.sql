set check_function_bodies = off;

select extensions.uuid_generate_v4();

update app.projects
set name = name
where false;

do $$
begin
    create type app.runtime_status as enum ('queued', 'running', 'done');
exception
    when duplicate_object then null;
end
$$;
