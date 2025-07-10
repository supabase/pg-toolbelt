import type { Sql } from "postgres";
import type { DependentDatabaseObject } from "../types.ts";

interface InspectedIndexRow {
  schema: string;
  name: string;
  table_schema: string;
  table_name: string;
  index_type: string;
  is_unique: boolean;
  is_primary: boolean;
  is_exclusion: boolean;
  nulls_not_distinct: boolean;
  immediate: boolean;
  key_columns: number[];
  included_columns: number[];
  column_options: number[];
  index_expressions: string | null;
  partial_predicate: string | null;
  owner: string;
}

export type InspectedIndex = InspectedIndexRow & DependentDatabaseObject;

function identifyIndex(index: InspectedIndexRow): string {
  return `${index.schema}.${index.table_name}.${index.name}`;
}

export async function inspectIndexes(
  sql: Sql,
): Promise<Map<string, InspectedIndex>> {
  const indexes = await sql<InspectedIndexRow[]>`
with extension_oids as (
  select
    objid
  from
    pg_depend d
  where
    d.refclassid = 'pg_extension'::regclass
    and d.classid = 'pg_class'::regclass
)
select
  c.relnamespace::regnamespace as schema,
  c.relname as name,
  tc.relnamespace::regnamespace as table_schema,
  tc.relname as table_name,
  am.amname as index_type,
  i.indisunique as is_unique,
  i.indisprimary as is_primary,
  i.indisexclusion as is_exclusion,
  i.indnullsnotdistinct as nulls_not_distinct,
  i.indimmediate as immediate,
  i.indkey as key_columns,
  array(
    select generate_series(1, array_length(i.indkey, 1))
    except
    select unnest(i.indkey)
  ) as included_columns,
  i.indoption as column_options,
  pg_get_expr(i.indexprs, i.indrelid) as index_expressions,
  pg_get_expr(i.indpred, i.indrelid) as partial_predicate,
  c.relowner::regrole as owner
from
  pg_catalog.pg_index i
  inner join pg_catalog.pg_class c on c.oid = i.indexrelid
  inner join pg_catalog.pg_class tc on tc.oid = i.indrelid
  inner join pg_catalog.pg_am am on am.oid = c.relam
  left outer join extension_oids e on c.oid = e.objid
  -- <EXCLUDE_INTERNAL>
  where not c.relnamespace::regnamespace::text like any(array['pg\\_%', 'information\\_schema'])
  and e.objid is null
  -- </EXCLUDE_INTERNAL>
order by
  1, 2;
  `;

  return new Map(
    indexes.map((i) => [
      identifyIndex(i),
      {
        ...i,
        dependent_on: [],
        dependents: [],
      },
    ]),
  );
}
