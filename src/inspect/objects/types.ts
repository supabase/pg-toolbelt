import type { Sql } from "postgres";

interface TypeColumn {
  attribute: string;
  type: string;
}

export interface InspectedType {
  schema: string;
  name: string;
  internal_name: string;
  size: string;
  description: string | null;
  columns: TypeColumn[] | null;
  owner: string;
}

export async function inspectTypes(sql: Sql): Promise<InspectedType[]> {
  const types = await sql<InspectedType[]>`
    with extension_oids as (
      select
        objid
      from
        pg_depend d
      where
        d.refclassid = 'pg_extension'::regclass
        and d.classid = 'pg_type'::regclass
    )
    select
      n.nspname as schema,
      pg_catalog.format_type(t.oid, null) as name,
      t.typname as internal_name,
      case when t.typrelid != 0 then
        cast('tuple' as pg_catalog.text)
      when t.typlen < 0 then
        cast('var' as pg_catalog.text)
      else
        cast(t.typlen as pg_catalog.text)
      end as size,
      pg_catalog.obj_description(t.oid, 'pg_type') as description,
      (array_to_json(array (
            select
              jsonb_build_object('attribute', attname, 'type', a.typname)
            from pg_class
            join pg_attribute on (attrelid = pg_class.oid)
            join pg_type a on (atttypid = a.oid)
            where (pg_class.reltype = t.oid)))) as columns,
      pg_get_userbyid(t.typowner) as owner
    from
      pg_catalog.pg_type t
      left join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where (t.typrelid = 0
      or (
        select
          c.relkind = 'c'
        from
          pg_catalog.pg_class c
        where
          c.oid = t.typrelid))
    and not exists (
      select
        1
      from
        pg_catalog.pg_type el
      where
        el.oid = t.typelem
        and el.typarray = t.oid)
    and n.nspname <> 'pg_catalog'
    and n.nspname <> 'information_schema'
    and pg_catalog.pg_type_is_visible(t.oid)
    and t.typcategory = 'C'
    and t.oid not in (
      select
        *
      from
        extension_oids)
    order by
      1,
      2;
`;

  return types;
}
