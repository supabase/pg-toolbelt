const ENUMS_QUERY = /* sql */ `
with extension_oids as (
  select
      objid
  from
      pg_depend d
  where
      d.refclassid = 'pg_extension'::regclass and
      d.classid = 'pg_type'::regclass
)
select
  n.nspname as "schema",
  t.typname as "name",
  array(
     select e.enumlabel
      from pg_catalog.pg_enum e
      where e.enumtypid = t.oid
      order by e.enumsortorder
  ) as elements
from pg_catalog.pg_type t
     left join pg_catalog.pg_namespace n on n.oid = t.typnamespace
     left outer join extension_oids e
       on t.oid = e.objid
where
  t.typcategory = 'E'
  and e.objid is null
  -- SKIP_INTERNAL and n.nspname not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
  -- SKIP_INTERNAL and n.nspname not like 'pg_temp_%' and n.nspname not like 'pg_toast_temp_%'
order by 1, 2;
`;
