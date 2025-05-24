import type { PGClient } from "../../types.ts";
import type { TableDefinition } from "./types.ts";

export async function extractTableDefinitions(
  db: PGClient,
): Promise<TableDefinition[]> {
  const tables = await db.sql<TableDefinition>`
    select 
      n.nspname || '.' || c.relname as id,
      n.nspname as schema_name,
      c.relname as table_name,
      c.reloptions as table_options,
      -- columns
      (
        select json_agg(
          json_build_object(
            'name', a.attname,
            'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
            'nullable', not a.attnotnull,
            'default', pg_get_expr(d.adbin, d.adrelid),
            'generated', a.attgenerated,
            'identity', a.attidentity
          )
          order by a.attnum
        )
        from pg_attribute a
        left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
        where a.attrelid = c.oid
        and a.attnum > 0  -- exclude system columns
        and not a.attisdropped  -- exclude dropped columns
      ) as columns
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r'  -- only regular tables
      and n.nspname not in ('pg_catalog', 'information_schema')
      and n.nspname not like 'pg_%'
    order by n.nspname, c.relname;
  `;

  return tables.rows;
}
