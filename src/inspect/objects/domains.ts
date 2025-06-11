const DOMAINS_QUERY = /* sql */ `
with extension_oids as (
  select
      objid
  from
      pg_depend d
  where
      d.refclassid = 'pg_extension'::regclass and
      d.classid = 'pg_type'::regclass
)
select n.nspname as "schema",
       t.typname as "name",
       pg_catalog.format_type(t.typbasetype, t.typtypmod) as "data_type",
       (select c.collname from pg_catalog.pg_collation c, pg_catalog.pg_type bt
        where c.oid = t.typcollation and bt.oid = t.typbasetype and t.typcollation <> bt.typcollation) as "collation",
        rr.conname as "constraint_name",
       t.typnotnull as "not_null",
       t.typdefault as "default",
       pg_catalog.array_to_string(array(
         select pg_catalog.pg_get_constraintdef(r.oid, true) from pg_catalog.pg_constraint r where t.oid = r.contypid
       ), ' ') as "check"
from pg_catalog.pg_type t
     left join pg_catalog.pg_namespace n on n.oid = t.typnamespace
     left join pg_catalog.pg_constraint rr on t.oid = rr.contypid
where t.typtype = 'd'
      and n.nspname <> 'pg_catalog'
      and n.nspname <> 'information_schema'
      and pg_catalog.pg_type_is_visible(t.oid)
      and t.oid not in (select * from extension_oids)
order by 1, 2;
`;
