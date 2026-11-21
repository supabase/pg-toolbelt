-- state B: app_owner is gone; app.t stays, owned by the applier.
-- Retiring the owner role must transfer ownership, never rebuild the table.
CREATE SCHEMA app;
CREATE TABLE app.t (id int);
