CREATE SCHEMA mine;
CREATE TABLE mine.visible (id int);
CREATE TABLE mine.delegated (id int);
GRANT SELECT ON mine.delegated TO app_owner WITH GRANT OPTION;
