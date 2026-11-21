CREATE TABLE public.t (id int);
CREATE ROLE r;
GRANT r TO current_user;
ALTER TABLE public.t OWNER TO r;
REVOKE r FROM current_user;
