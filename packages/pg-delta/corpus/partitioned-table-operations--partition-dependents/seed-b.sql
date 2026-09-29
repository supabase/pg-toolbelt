-- routed through the parent: PG14 partitions do not inherit the identity
INSERT INTO app.messages (inserted_at, body) VALUES ('2024-03-01', 'a'), ('2026-03-01', 'b');
