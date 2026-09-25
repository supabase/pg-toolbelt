-- region appears only inside the partition key expression. It still counts as
-- a key column, so retyping it must replace the partitioned table.
CREATE SCHEMA test_schema;

CREATE TABLE test_schema.accounts (region varchar(32)) PARTITION BY LIST (lower(region));
