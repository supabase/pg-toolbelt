-- A real WITH CHECK change replaces the policy, which re-reads its unchanged
-- USING clause too. Both sides spell USING the same, but not in the form
-- Postgres settles on, so the planned policy must carry USING's stable text.
CREATE SCHEMA s;
CREATE TABLE s.p (a int, b int);
ALTER TABLE s.p ENABLE ROW LEVEL SECURITY;
CREATE POLICY pol ON s.p FOR UPDATE USING (b BETWEEN 0 AND 10 AND a >= 0) WITH CHECK (a > 1);
