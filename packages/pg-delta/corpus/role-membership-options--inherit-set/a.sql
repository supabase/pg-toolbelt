-- state A: plain memberships (INHERIT from the member, SET true).
CREATE ROLE mo_parent NOLOGIN;
CREATE ROLE mo_other NOLOGIN;
CREATE ROLE mo_child NOLOGIN;
CREATE ROLE mo_noinherit NOLOGIN NOINHERIT;
GRANT mo_parent TO mo_child;
GRANT mo_parent TO mo_noinherit;
