create function public.touch_fn() returns trigger language plpgsql as $$ begin return new; end $$;
