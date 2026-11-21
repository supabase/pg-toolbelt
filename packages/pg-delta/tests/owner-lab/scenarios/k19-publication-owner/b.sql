CREATE TABLE public.items (id int primary key);
CREATE ROLE preview_user LOGIN;
DO $$ BEGIN EXECUTE format('GRANT CREATE ON DATABASE %I TO preview_user', current_database()); END $$;
CREATE PUBLICATION electric_publication_default FOR TABLE public.items;
GRANT preview_user TO current_user;
ALTER PUBLICATION electric_publication_default OWNER TO preview_user;
REVOKE preview_user FROM current_user;
