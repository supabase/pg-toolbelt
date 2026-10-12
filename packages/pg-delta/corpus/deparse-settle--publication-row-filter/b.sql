-- Publication row filters store the same nested-OR shape as the expressions in
-- deparse-settle--row-distinct-equivalent: the a -> b plan must be empty.
CREATE SCHEMA s;

CREATE TABLE s.t (a int, b int, c int);

CREATE PUBLICATION pb FOR TABLE s.t
  WHERE ((a, b, c) IS DISTINCT FROM (1, 2, 3))
  WITH (publish = 'insert');
