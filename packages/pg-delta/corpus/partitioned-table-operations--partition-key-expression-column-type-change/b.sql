CREATE SCHEMA test_schema;

CREATE TABLE test_schema.accounts (region varchar(64)) PARTITION BY LIST (lower(region));
