CREATE ROLE a_user NOLOGIN;
CREATE ROLE o_own NOLOGIN;
CREATE ROLE h_hold NOLOGIN;
CREATE ROLE x_reader NOLOGIN;
GRANT o_own TO lab_applier;
GRANT h_hold TO lab_applier;
