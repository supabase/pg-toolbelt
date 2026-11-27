-- t1.r uses t2's row type, and retyping t2.id rewrites t2: PostgreSQL refuses
-- that rewrite once t1 exists, so t2 must change first.
CREATE TABLE t2 (id bigint);
CREATE TABLE t1 (r t2);
