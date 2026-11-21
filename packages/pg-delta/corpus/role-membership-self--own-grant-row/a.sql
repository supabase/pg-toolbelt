-- state A: maker holds ADMIN on two roles (granted by the bootstrap superuser)
-- and has its own grant row (grantor = itself) on `kept` only.
CREATE ROLE maker CREATEROLE;
CREATE ROLE kept NOLOGIN;
CREATE ROLE dropped NOLOGIN;
CREATE ROLE added NOLOGIN;
GRANT kept TO maker WITH ADMIN OPTION;
GRANT dropped TO maker WITH ADMIN OPTION;
GRANT added TO maker WITH ADMIN OPTION;
GRANT kept TO maker WITH INHERIT FALSE, SET TRUE GRANTED BY maker;
GRANT dropped TO maker WITH INHERIT TRUE, SET TRUE GRANTED BY maker;
