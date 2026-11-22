CREATE SCHEMA s;
CREATE TABLE s.orders (id int, created_on date) PARTITION BY RANGE (created_on);
CREATE INDEX orders_id_idx ON ONLY s.orders (id) WITH (fillfactor = 70);
