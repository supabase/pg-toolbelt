CREATE COLLATION co (provider = icu, locale = 'und-u-ks-level2', deterministic = false);
CREATE TABLE t (id int, c text COLLATE co);
