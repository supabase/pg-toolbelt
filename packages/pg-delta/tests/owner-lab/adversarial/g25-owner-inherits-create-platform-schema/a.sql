CREATE ROLE app_owner NOLOGIN;
GRANT devs TO app_owner;
CREATE TABLE svc.t (id int);
