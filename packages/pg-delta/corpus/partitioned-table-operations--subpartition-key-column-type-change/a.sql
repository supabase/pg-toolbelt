-- created_on is not in the root's partition key. It is the key of a
-- sub-partition. ALTER COLUMN ... TYPE on the root recurses into that
-- sub-partition, and Postgres rejects it there. The plan must replace the root.
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.events (region text, created_on date) PARTITION BY LIST (region);
CREATE TABLE test_schema.events_eu PARTITION OF test_schema.events
  FOR VALUES IN ('eu') PARTITION BY RANGE (created_on);
