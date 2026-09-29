-- The root gains created_on, and a new sub-partition under the intermediate
-- events_eu is keyed on it. events_eu inherits the column from the root, so
-- the sub-partition's CREATE must wait for the root's ADD COLUMN.
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.events (region text, zone text, created_on date) PARTITION BY LIST (region);
CREATE TABLE test_schema.events_eu PARTITION OF test_schema.events
  FOR VALUES IN ('eu') PARTITION BY LIST (zone);
CREATE TABLE test_schema.events_eu_west PARTITION OF test_schema.events_eu
  FOR VALUES IN ('west') PARTITION BY RANGE (created_on);
