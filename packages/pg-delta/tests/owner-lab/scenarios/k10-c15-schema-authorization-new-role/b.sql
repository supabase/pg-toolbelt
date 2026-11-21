CREATE ROLE app;
GRANT app TO current_user;
CREATE SCHEMA app AUTHORIZATION app;
REVOKE app FROM current_user;
