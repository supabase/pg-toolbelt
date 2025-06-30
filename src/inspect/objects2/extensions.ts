import type { Sql } from "postgres";

export interface InspectedExtension {
  name: string;
  schema: string;
  relocatable: boolean;
  version: string;
  owner: string;
}

export function identifyExtension(extension: InspectedExtension): string {
  return `${extension.schema}.${extension.name}`;
}

export async function inspectExtensions(
  sql: Sql,
): Promise<Map<string, InspectedExtension>> {
  const extensions = await sql<InspectedExtension[]>`
select
  extname as name,
  n.nspname as schema,
  extrelocatable as relocatable,
  extversion as version,
  pg_get_userbyid(extowner) as owner
from
  pg_catalog.pg_extension e
  inner join pg_catalog.pg_namespace n on n.oid = e.extnamespace
  -- <EXCLUDE_INTERNAL>
  where n.nspname not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
  and n.nspname not like 'pg_temp_%' and n.nspname not like 'pg_toast_temp_%'
  -- </EXCLUDE_INTERNAL>
order by
  1;
  `;

  return new Map(extensions.map((e) => [identifyExtension(e), e]));
}
