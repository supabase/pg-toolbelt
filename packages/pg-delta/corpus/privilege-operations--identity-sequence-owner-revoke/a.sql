-- state A: the owner revoked one of its own default privileges on the identity
-- column's backing sequence.
CREATE SCHEMA test_schema;
CREATE TABLE test_schema.t_ident (id bigint GENERATED ALWAYS AS IDENTITY, v int);
REVOKE UPDATE ON SEQUENCE test_schema.t_ident_id_seq FROM CURRENT_USER;
