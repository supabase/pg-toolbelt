CREATE ROLE inventory_owner NOLOGIN;
GRANT inventory_owner TO current_user;
CREATE SCHEMA inventory AUTHORIZATION inventory_owner;
SET ROLE inventory_owner;
CREATE DOMAIN inventory.sku AS text CHECK (VALUE ~ '^[A-Z]{3}-[0-9]{4}$');
CREATE TYPE inventory.dimensions AS (length_cm numeric, width_cm numeric, height_cm numeric);
CREATE TABLE inventory.products (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku inventory.sku NOT NULL,
  size inventory.dimensions,
  unit_price_cents int NOT NULL DEFAULT 0,
  quantity int NOT NULL DEFAULT 0,
  stock_value_cents bigint GENERATED ALWAYS AS (unit_price_cents::bigint * quantity) STORED
);
RESET ROLE;
REVOKE inventory_owner FROM current_user;
