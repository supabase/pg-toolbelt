CREATE SCHEMA test_schema;
CREATE TABLE test_schema.orders (
  order_id integer NOT NULL,
  created_on date NOT NULL,
  status text
) PARTITION BY RANGE (created_on);
CREATE TABLE test_schema.orders_2024 PARTITION OF test_schema.orders
  FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
CREATE INDEX idx_orders_status_old ON ONLY test_schema.orders (status);
CREATE INDEX orders_2024_status_idx ON test_schema.orders_2024 (status);
ALTER INDEX test_schema.idx_orders_status_old ATTACH PARTITION test_schema.orders_2024_status_idx;
