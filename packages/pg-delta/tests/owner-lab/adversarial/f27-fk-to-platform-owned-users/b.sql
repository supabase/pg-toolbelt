CREATE ROLE authenticated NOLOGIN;
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  username text UNIQUE,
  avatar_url text
);
GRANT SELECT ON public.profiles TO authenticated;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users (id) ON DELETE CASCADE;
CREATE TABLE public.posts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  author_id uuid NOT NULL REFERENCES auth.users (id),
  body text NOT NULL DEFAULT ''
);
GRANT SELECT, INSERT ON public.posts TO authenticated;
