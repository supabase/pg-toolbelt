const RELATIONS_QUERY = /* sql */ `
with extension_oids as (
  select
      objid
  from
      pg_depend d
  where
      d.refclassid = 'pg_extension'::regclass and
      d.classid = 'pg_class'::regclass
), enums as (

  select
    t.oid as enum_oid,
    n.nspname as "schema",
    t.typname as name
  from pg_catalog.pg_type t
       left join pg_catalog.pg_namespace n on n.oid = t.typnamespace
       left outer join extension_oids e
         on t.oid = e.objid
  where
    t.typcategory = 'E'
    and e.objid is null
    -- SKIP_INTERNAL and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
    -- SKIP_INTERNAL and n.nspname not like 'pg_temp_%' and n.nspname not like 'pg_toast_temp_%'
  order by 1, 2
),
r as (
    select
        c.relname as name,
        n.nspname as schema,
        c.relkind as relationtype,
        c.oid as oid,
        case when c.relkind in ('m', 'v') then
          pg_get_viewdef(c.oid)
        else null end
          as definition,
        (select
              '"' || nmsp_parent.nspname || '"."' || parent.relname || '"' as parent
          from pg_inherits
              join pg_class parent            on pg_inherits.inhparent = parent.oid
              join pg_class child             on pg_inherits.inhrelid   = child.oid
              join pg_namespace nmsp_parent   on nmsp_parent.oid  = parent.relnamespace
              join pg_namespace nmsp_child    on nmsp_child.oid   = child.relnamespace
          where child.oid = c.oid)
        as parent_table,
        case when c.relpartbound is not null then
          pg_get_expr(c.relpartbound, c.oid, true)
        when c.relhassubclass is not null then
          pg_catalog.pg_get_partkeydef(c.oid)
        end
        as partition_def,
        c.relrowsecurity::boolean as rowsecurity,
        c.relforcerowsecurity::boolean as forcerowsecurity,
        c.relpersistence as persistence,
        c.relpages as page_size_estimate,
        c.reltuples as row_count_estimate
    from
        pg_catalog.pg_class c
        inner join pg_catalog.pg_namespace n
          on n.oid = c.relnamespace
        left outer join extension_oids e
          on c.oid = e.objid
    where c.relkind in ('r', 'v', 'm', 'c', 'p')
    -- SKIP_INTERNAL and e.objid is null
    -- SKIP_INTERNAL and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
    -- SKIP_INTERNAL and n.nspname not like 'pg_temp_%' and n.nspname not like 'pg_toast_temp_%'
)
select
    r.relationtype,
    r.schema,
    r.name,
    r.definition as definition,
    a.attnum as position_number,
    a.attname as attname,
    a.attnotnull as not_null,
    a.atttypid::regtype as datatype,
    a.attidentity != '' as is_identity,
    a.attidentity = 'a' as is_identity_always,
    -- PRE_12 false as is_generated,
    -- 12_ONLY a.attgenerated != '' as is_generated,
    (select c.collname from pg_catalog.pg_collation c, pg_catalog.pg_type t
     where c.oid = a.attcollation and t.oid = a.atttypid and a.attcollation <> t.typcollation) as collation,
    pg_get_expr(ad.adbin, ad.adrelid) as defaultdef,
    r.oid as oid,
    format_type(atttypid, atttypmod) as datatypestring,
    e.enum_oid is not null as is_enum,
    e.name as enum_name,
    e.schema as enum_schema,
    pg_catalog.obj_description(r.oid) as comment,
    r.parent_table,
    r.partition_def,
    r.rowsecurity,
    r.forcerowsecurity,
    r.persistence,
    r.page_size_estimate,
    r.row_count_estimate
from
    r
    left join pg_catalog.pg_attribute a
        on r.oid = a.attrelid and a.attnum > 0
    left join pg_catalog.pg_attrdef ad
        on a.attrelid = ad.adrelid
        and a.attnum = ad.adnum
    left join enums e
      on a.atttypid = e.enum_oid
where a.attisdropped is not true
-- SKIP_INTERNAL and r.schema not in ('pg_catalog', 'information_schema', 'pg_toast')
-- SKIP_INTERNAL and r.schema not like 'pg_temp_%' and r.schema not like 'pg_toast_temp_%'
order by relationtype, r.schema, r.name, position_number;
`;
