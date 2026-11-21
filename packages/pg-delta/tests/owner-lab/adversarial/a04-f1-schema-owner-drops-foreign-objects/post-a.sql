GRANT CREATE ON SCHEMA public TO xo;
CREATE TABLE public.foreign_t (id int);
ALTER TABLE public.foreign_t OWNER TO xo;
CREATE FUNCTION public.ff() RETURNS int LANGUAGE sql AS 'select 1';
ALTER FUNCTION public.ff() OWNER TO xo;
REVOKE CREATE ON SCHEMA public FROM xo;
