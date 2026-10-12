-- A row filter's column dependencies are recorded on the publication, not on
-- its member. Changing the type of a filtered column re-resolves the filter
-- (`a > 0` reads `a > (0)::numeric`), so the target's filter text cannot stand
-- for the desired one, and Postgres refuses to retype a column a publication
-- WHERE clause uses: the membership must be rebuilt around the type change.
CREATE SCHEMA s;
CREATE TABLE s.t (id int PRIMARY KEY, a numeric);
CREATE PUBLICATION p FOR TABLE s.t WHERE (a > 0) WITH (publish = 'insert');
