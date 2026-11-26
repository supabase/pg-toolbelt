CREATE COLLATION co (provider = icu, locale = 'und', deterministic = false);
CREATE TABLE t (id int, c text COLLATE co);
