-- created_on is the key of the sub-partition events_eu, not of the root.
-- DROP COLUMN on the root recurses into events_eu and Postgres rejects it
-- there, so dropping the column must replace the root.
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.events (region text, created_on date) PARTITION BY LIST (region);
CREATE TABLE test_schema.events_eu PARTITION OF test_schema.events
  FOR VALUES IN ('eu') PARTITION BY RANGE (created_on);
CREATE TABLE test_schema.events_eu_2024 PARTITION OF test_schema.events_eu
  FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
