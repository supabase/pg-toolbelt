-- b.sql: id is NOT NULL without a default, so the autoseed default insert cannot reach it
INSERT INTO test_schema.t_ident (id, v) VALUES (1, 1);
