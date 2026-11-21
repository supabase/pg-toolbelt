CREATE ROLE r NOLOGIN;
GRANT CREATE ON SCHEMA public TO r;
CREATE TABLE public.t (id int);
GRANT r TO current_user;
ALTER TABLE public.t OWNER TO r;
REVOKE r FROM current_user;
