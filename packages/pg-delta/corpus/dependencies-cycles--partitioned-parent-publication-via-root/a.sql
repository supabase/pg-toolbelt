-- same-name heap table: partitionKey replace emits DROP TABLE + CREATE PARTITION BY
CREATE SCHEMA s1;

CREATE TABLE s1.parent (
  id integer NOT NULL DEFAULT 1,
  created_on date NOT NULL DEFAULT '2024-06-01',
  payload text DEFAULT ''
);
