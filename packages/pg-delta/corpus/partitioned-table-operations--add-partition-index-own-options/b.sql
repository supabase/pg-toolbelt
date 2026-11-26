-- A new partition whose index was created without the parent index's
-- fillfactor and then attached. PARTITION OF copies the parent's options, so
-- the plan resets them on the materialized index.
CREATE SCHEMA s;
CREATE TABLE s.orders (id int, created_on date) PARTITION BY RANGE (created_on);
CREATE INDEX orders_id_idx ON ONLY s.orders (id) WITH (fillfactor = 70);
CREATE TABLE s.orders_2024 (id int, created_on date);
CREATE INDEX orders_2024_id_idx ON s.orders_2024 (id);
ALTER TABLE s.orders ATTACH PARTITION s.orders_2024
  FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
ALTER INDEX s.orders_id_idx ATTACH PARTITION s.orders_2024_id_idx;
