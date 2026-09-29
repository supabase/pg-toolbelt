CREATE SCHEMA test_schema;

CREATE TABLE test_schema.events (region text) PARTITION BY LIST (region);
CREATE TABLE test_schema.events_eu PARTITION OF test_schema.events
  FOR VALUES IN ('eu');
