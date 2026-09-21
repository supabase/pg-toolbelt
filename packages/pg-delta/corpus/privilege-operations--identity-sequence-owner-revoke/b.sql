-- state B: the owner holds its full default privileges on the backing sequence.
CREATE SCHEMA test_schema;
CREATE TABLE test_schema.t_ident (id bigint GENERATED ALWAYS AS IDENTITY, v int);
