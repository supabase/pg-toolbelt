import type { Sql } from "postgres";

export interface InspectedIndex {
  schema: string;
  table_name: string;
  name: string;
  oid: number;
  extension_oid: number | null;
  definition: string;
  index_columns: string[];
  key_options: number[];
  total_column_count: number;
  key_column_count: number;
  num_att: number;
  included_column_count: number;
  is_unique: boolean;
  is_pk: boolean;
  is_exclusion: boolean;
  is_immediate: boolean;
  is_clustered: boolean;
  key_collations: number[];
  key_expressions: string | null;
  partial_predicate: string | null;
  algorithm: string;
  key_columns: string[];
  included_columns: string[] | null;
}

export async function inspectIndexes(sql: Sql): Promise<InspectedIndex[]> {
  const indexes = await sql<InspectedIndex[]>`
with extension_oids as (
  select
    objid,
    classid::regclass::text as classid
  from
    pg_depend d
  where
    d.refclassid = 'pg_extension'::regclass
    and d.classid = 'pg_index'::regclass
),
extension_relations as (
  select
    objid
  from
    pg_depend d
  where
    d.refclassid = 'pg_extension'::regclass
    and d.classid = 'pg_class'::regclass
),
pre as (
  select
    n.nspname as schema,
    c.relname as table_name,
    i.relname as name,
    i.oid as oid,
    e.objid as extension_oid,
    pg_get_indexdef(i.oid) as definition,
    (
      select
        array_agg(attname order by ik.n)
      from
        unnest(x.indkey)
        with ordinality ik (i, n)
        join pg_attribute aa on aa.attrelid = x.indrelid
          and ik.i = aa.attnum) index_columns,
        indoption key_options,
        indnatts total_column_count,
        indnkeyatts key_column_count,
        indnatts num_att,
        indnatts - indnkeyatts included_column_count,
        indisunique is_unique,
        indisprimary is_pk,
        indisexclusion is_exclusion,
        indimmediate is_immediate,
        indisclustered is_clustered,
        indcollation key_collations,
        pg_get_expr(indexprs, indrelid) key_expressions,
      pg_get_expr(indpred, indrelid) partial_predicate,
      amname algorithm
    from
      pg_index x
    join pg_class c on c.oid = x.indrelid
    join pg_class i on i.oid = x.indexrelid
    join pg_am am on i.relam = am.oid
    left join pg_namespace n on n.oid = c.relnamespace
    left join extension_oids e on i.oid = e.objid
    left join extension_relations er on c.oid = er.objid
  where
    x.indislive
    and c.relkind in ('r', 'm', 'p')
    and i.relkind in ('i', 'I')
    -- <EXCLUDE_INTERNAL>
    and nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
    and nspname not like 'pg_temp_%'
    and nspname not like 'pg_toast_temp_%'
    and e.objid is null
    and er.objid is null
    -- </EXCLUDE_INTERNAL>
)
select
  *,
  index_columns[1:key_column_count] as key_columns,
  index_columns[key_column_count + 1:array_length(index_columns, 1)] as included_columns
from
  pre
order by
  1,
  2,
  3;
  `;

  return indexes;
}
