CREATE COLLATION co (locale = 'C');
CREATE TABLE t (id int, c text COLLATE co);
