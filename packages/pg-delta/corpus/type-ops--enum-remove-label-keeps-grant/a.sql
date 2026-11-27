CREATE ROLE corpus_enum_user NOLOGIN;
CREATE TYPE mood AS ENUM ('sad', 'happy');
GRANT USAGE ON TYPE mood TO corpus_enum_user;
