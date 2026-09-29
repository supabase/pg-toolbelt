CREATE SCHEMA s1;
CREATE SCHEMA s2;

CREATE TABLE s1.parent (
  id integer NOT NULL DEFAULT 1,
  created_on date NOT NULL DEFAULT '2024-06-01',
  period date NOT NULL DEFAULT '2024-06-01'
) PARTITION BY RANGE (created_on);

CREATE TABLE s2.p1 PARTITION OF s1.parent
  FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');

CREATE PUBLICATION pub_warehouse FOR TABLE s1.parent WITH (
  publish_via_partition_root = true
);
