create table public.shipments (
  id bigint generated always as identity primary key,
  status public.shipment_status not null default 'pending'
);
