-- CLI-2299: partitioned parent, ON ONLY index, s2 partitions, via_root publication.
-- Replace-path from a.sql (heap → PARTITION BY). Extract membership is parent-only.
CREATE SCHEMA s1;
CREATE SCHEMA s2;

CREATE TABLE s1.parent (
  id integer NOT NULL DEFAULT 1,
  created_on date NOT NULL DEFAULT '2024-06-01',
  payload text DEFAULT '',
  PRIMARY KEY (id, created_on)
) PARTITION BY RANGE (created_on);

CREATE INDEX idx_parent_payload ON s1.parent (payload);

CREATE TABLE s2.p1 PARTITION OF s1.parent
  FOR VALUES FROM ('2024-01-01') TO ('2024-07-01');
CREATE TABLE s2.p2 PARTITION OF s1.parent
  FOR VALUES FROM ('2024-07-01') TO ('2025-01-01');
CREATE TABLE s2.p3 PARTITION OF s1.parent
  FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');

CREATE PUBLICATION pub_warehouse FOR TABLE s1.parent WITH (
  publish_via_partition_root = true
);
