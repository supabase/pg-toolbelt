import type { Sql } from "postgres";

export type InspectedExtension = {
  schema: string;
  name: string;
  version: string;
  oid: number;
  owner: string;
};

export async function inspectExtensions(
  sql: Sql,
): Promise<InspectedExtension[]> {
  const extensions = await sql<InspectedExtension[]>`
    select
      nspname as schema,
      extname as name,
      extversion as version,
      e.oid as oid,
      pg_get_userbyid(e.extowner) as owner
    from
      pg_extension e
      inner join pg_namespace on pg_namespace.oid = e.extnamespace
    order by
      schema,
      name;
  `;

  return extensions;
}
