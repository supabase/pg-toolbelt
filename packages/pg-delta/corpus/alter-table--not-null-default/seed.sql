-- no NULLs, so SET NOT NULL succeeds
INSERT INTO app.t (id, status, note, mood) VALUES (1, 'a', 'b', 'e');
