-- state B: PG16+ membership options differ from A. The changed INHERIT / SET
-- of mo_child is one statement; a new membership spells only the options a
-- plain grant would not give (INHERIT defaults to the member's own).
CREATE ROLE mo_parent NOLOGIN;
CREATE ROLE mo_other NOLOGIN;
CREATE ROLE mo_child NOLOGIN;
CREATE ROLE mo_noinherit NOLOGIN NOINHERIT;
GRANT mo_parent TO mo_child WITH INHERIT FALSE, SET FALSE;
GRANT mo_parent TO mo_noinherit WITH INHERIT TRUE;
GRANT mo_other TO mo_child WITH ADMIN TRUE, SET FALSE;
GRANT mo_other TO mo_noinherit WITH INHERIT TRUE;
