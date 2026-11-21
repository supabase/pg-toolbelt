GRANT lab_applier TO r_sch;
CREATE SCHEMA s AUTHORIZATION r_sch;
GRANT USAGE, CREATE ON SCHEMA s TO lab_applier;
CREATE TABLE s.t (id int);
ALTER TABLE s.t OWNER TO lab_applier;
