-- one row per partition, each satisfying its hash remainder
INSERT INTO s.t_a (id, k)
SELECT g, 'k' || g FROM generate_series(1, 500) g
WHERE satisfies_hash_partition('s.t'::regclass, 4, 2, 'k' || g)
LIMIT 1;
INSERT INTO s.t_b (id, k)
SELECT g, 'k' || g FROM generate_series(1, 500) g
WHERE satisfies_hash_partition('s.t'::regclass, 4, 0, 'k' || g)
LIMIT 1;
