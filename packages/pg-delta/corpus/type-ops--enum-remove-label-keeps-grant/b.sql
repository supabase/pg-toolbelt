-- Removing a label rebuilds the enum; the rebuilt type must keep the grant.
CREATE ROLE corpus_enum_user NOLOGIN;
CREATE TYPE mood AS ENUM ('sad');
GRANT USAGE ON TYPE mood TO corpus_enum_user;
