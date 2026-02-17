create schema app;

grant usage on schema app to app_reader;
grant usage on schema app to app_writer;

alter default privileges for role app_owner in schema app
grant select on tables to app_reader;
