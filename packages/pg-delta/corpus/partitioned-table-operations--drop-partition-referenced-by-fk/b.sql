CREATE SCHEMA s;

CREATE TABLE s.t (id bigint NOT NULL, k int NOT NULL) PARTITION BY RANGE (k);
ALTER TABLE s.t ADD PRIMARY KEY (id, k);
CREATE TABLE s.r (id bigint, k int, FOREIGN KEY (id, k) REFERENCES s.t (id, k));
