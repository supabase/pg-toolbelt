-- state B: the own row on `kept` changes options, the one on `dropped` goes
-- with the whole membership, and `added` gains one. Only the own row (grantor
-- = member) is modelled; the ADMIN rows stay as they are.
CREATE ROLE maker CREATEROLE;
CREATE ROLE kept NOLOGIN;
CREATE ROLE dropped NOLOGIN;
CREATE ROLE added NOLOGIN;
GRANT kept TO maker WITH ADMIN OPTION;
GRANT added TO maker WITH ADMIN OPTION;
GRANT kept TO maker WITH INHERIT TRUE, SET FALSE GRANTED BY maker;
GRANT added TO maker WITH INHERIT TRUE, SET TRUE GRANTED BY maker;
