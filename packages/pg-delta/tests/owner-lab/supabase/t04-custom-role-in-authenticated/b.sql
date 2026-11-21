create role app2 nologin;
create role app3 nologin;
grant authenticated to app2;
grant anon to app2 with admin option;
grant app3 to authenticated;
grant app3 to service_role;
