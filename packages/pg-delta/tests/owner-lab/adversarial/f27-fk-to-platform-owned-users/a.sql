CREATE ROLE authenticated NOLOGIN;
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  username text UNIQUE,
  avatar_url text
);
GRANT SELECT ON public.profiles TO authenticated;
