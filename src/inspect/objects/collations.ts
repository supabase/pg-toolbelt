import type { Sql } from "postgres";

export type InspectedCollation = {
  name: string;
  schema: string;
  owner: string;
  provider: string;
  encoding: number;
  lc_collate: string;
  lc_ctype: string;
  version: string | null;
};

export async function inspectCollations(sql: Sql) {
  const collations = await sql<InspectedCollation[]>`
    select
      collname as name,
      n.nspname as schema,
      pg_get_userbyid(c.collowner) as owner,
      case collprovider
      when 'd' then
        'database default'
      when 'i' then
        'icu'
      when 'c' then
        'libc'
      end as provider,
      collencoding as encoding,
      collcollate as lc_collate,
      collctype as lc_ctype,
      collversion as version
    from
      pg_collation c
      inner join pg_namespace n on n.oid = c.collnamespace
      -- <EXCLUDE_INTERNAL>
      where nspname not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
      and nspname not like 'pg_temp_%' and nspname not like 'pg_toast_temp_%'
      -- </EXCLUDE_INTERNAL>
    order by
      2,
      1;
  `;

  return collations;
}
