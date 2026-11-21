CREATE ROLE r NOLOGIN;
CREATE TABLE public.p (id int);
GRANT CREATE ON SCHEMA public TO r;
GRANT r TO current_user;
ALTER TABLE public.p OWNER TO r;
REVOKE r FROM current_user;
REVOKE CREATE ON SCHEMA public FROM r;
