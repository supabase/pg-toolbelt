create table public.people (
  id bigint primary key,
  org_id integer not null,
  merge_target_id bigint
);
create unique index uq_people_org_id_id on public.people (org_id, id);
alter table public.people
  add constraint people_merge_target_fkey
  foreign key (org_id, merge_target_id) references public.people (org_id, id);
