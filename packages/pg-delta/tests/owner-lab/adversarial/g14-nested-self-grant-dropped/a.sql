CREATE ROLE orders_owner NOLOGIN;
CREATE ROLE app_admin NOLOGIN;
GRANT orders_owner TO app_admin;
GRANT app_admin TO current_user;
CREATE SCHEMA app;
GRANT USAGE, CREATE ON SCHEMA app TO orders_owner;
CREATE TABLE app.orders (id bigint);
ALTER TABLE app.orders OWNER TO orders_owner;
