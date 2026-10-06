create view public.order_amounts as
  select id, amount from public.orders where amount > 0;
