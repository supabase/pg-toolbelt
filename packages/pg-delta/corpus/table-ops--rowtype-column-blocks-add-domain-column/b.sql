-- t1.r uses t2's row type, and adding a column of a CHECK domain rewrites t2:
-- PostgreSQL refuses that rewrite once t1 exists, so t2 must change first.
CREATE DOMAIN posint AS integer CHECK (VALUE > 0);
CREATE TABLE t2 (id integer, p posint);
CREATE TABLE t1 (r t2);
