-- Two parents give x conflicting defaults; CREATE TABLE ... INHERITS succeeds
-- only when the child declares its own default in the same statement.
CREATE SCHEMA s;

CREATE TABLE s.a_parent1 (id int, x int DEFAULT 1);
CREATE TABLE s.a_parent2 (x int DEFAULT 2);
CREATE TABLE s.z_child (x int DEFAULT 3) INHERITS (s.a_parent1, s.a_parent2);
