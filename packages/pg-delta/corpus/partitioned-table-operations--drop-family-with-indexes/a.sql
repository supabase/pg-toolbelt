-- A partitioned table with parent indexes (child indexes attached on every
-- partition). The forward diff drops the whole family in one plan.
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.request_logs (
  id integer NOT NULL,
  created_on date NOT NULL,
  status text
) PARTITION BY RANGE (created_on);

CREATE INDEX idx_request_logs_status ON test_schema.request_logs (status);
CREATE INDEX idx_request_logs_created_on ON test_schema.request_logs (created_on);

CREATE TABLE test_schema.request_logs_2024 PARTITION OF test_schema.request_logs
  FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');

CREATE TABLE test_schema.request_logs_2025 PARTITION OF test_schema.request_logs
  FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');

CREATE TABLE test_schema.request_logs_default PARTITION OF test_schema.request_logs DEFAULT;
