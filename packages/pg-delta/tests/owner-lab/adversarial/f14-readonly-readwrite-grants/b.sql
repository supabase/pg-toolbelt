CREATE ROLE app_owner NOLOGIN;
CREATE ROLE app_readonly NOLOGIN;
CREATE ROLE app_readwrite NOLOGIN;
CREATE SCHEMA app;
GRANT USAGE ON SCHEMA app TO app_readonly, app_readwrite;
GRANT USAGE, CREATE ON SCHEMA app TO app_owner;
GRANT app_owner TO current_user;
SET ROLE app_owner;
CREATE TABLE app.customers (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, email text);
CREATE TABLE app.orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id bigint REFERENCES app.customers (id),
  total_cents bigint NOT NULL DEFAULT 0
);
CREATE TABLE app.audit_log (id bigserial PRIMARY KEY, msg text);
GRANT SELECT ON app.customers, app.orders TO app_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.customers, app.orders TO app_readwrite;
GRANT INSERT ON app.audit_log TO app_readwrite;
GRANT USAGE ON SEQUENCE app.audit_log_id_seq TO app_readwrite;
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM app_owner;
REVOKE app_owner FROM current_user;
