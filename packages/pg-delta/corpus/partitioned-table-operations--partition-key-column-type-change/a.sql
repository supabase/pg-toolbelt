-- Postgres rejects ALTER COLUMN ... TYPE on a partition key column. To retype
-- the key, the plan must replace the partitioned table.
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.messages (inserted_at timestamptz) PARTITION BY RANGE (inserted_at);
CREATE TABLE test_schema.messages_2024 PARTITION OF test_schema.messages
  FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
