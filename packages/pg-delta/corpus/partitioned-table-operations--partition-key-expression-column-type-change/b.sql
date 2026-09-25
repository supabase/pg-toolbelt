CREATE SCHEMA test_schema;

CREATE TABLE test_schema.accounts (region text) PARTITION BY LIST (lower(region));
