CREATE COLLATION co (locale = 'POSIX');
CREATE TABLE t (id int, c text COLLATE co);
