CREATE ROLE app_owner NOLOGIN;
CREATE SCHEMA app;
GRANT USAGE, CREATE ON SCHEMA app TO app_owner;
GRANT app_owner TO current_user;
SET ROLE app_owner;
CREATE TYPE app.order_status AS ENUM ('pending', 'paid', 'shipped');
CREATE TABLE app.orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  status app.order_status NOT NULL DEFAULT 'pending'
);
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM app_owner;
REVOKE app_owner FROM current_user;
