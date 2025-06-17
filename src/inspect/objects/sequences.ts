import type { Sql } from "postgres";

export interface InspectedSequence {
  schema: string;
  name: string;
  table_name: string | null;
  column_name: string | null;
  is_identity: boolean;
}

export async function inspectSequences(sql: Sql): Promise<InspectedSequence[]> {
  const sequences = await sql<InspectedSequence[]>`
with extension_objids as (
select
    objid as extension_objid
from
    pg_depend d
where
    d.refclassid = 'pg_extension'::regclass
    and d.classid = 'pg_class'::regclass
),
pre as (
select
    n.nspname as schema,
    c.relname as name,
    c_ref.relname as table_name,
    a.attname as column_name,
    --a.attname is not null as has_table_owner,
    --a.attidentity is distinct from '' as is_identity,
    d.deptype is not distinct from 'i' as is_identity
    --a.attidentity = 'a' as is_identity_always
from
    --pg_sequence s
    --inner join pg_class c
    --    on s.seqrelid = c.oid
    pg_class c
    inner join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    left join extension_objids on c.oid = extension_objids.extension_objid
    left join pg_depend d on c.oid = d.objid
    and d.deptype in ('i', 'a')
    left join pg_class c_ref on d.refobjid = c_ref.oid
    left join pg_attribute a on (a.attnum = d.refobjsubid
        and a.attrelid = d.refobjid)
where
    c.relkind = 'S'
    -- <EXCLUDE_INTERNAL>
    and n.nspname not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
    and n.nspname not like 'pg_temp_%' and n.nspname not like 'pg_toast_temp_%'
    -- </EXCLUDE_INTERNAL>
    and extension_objids.extension_objid is null
)
select
*
from
pre
where
not is_identity
order by
1,
2;
  `;

  return sequences;
}
