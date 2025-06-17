import type { Sql } from "postgres";

export interface InspectedPrivilege {
  schema: string;
  name: string;
  object_type: string;
  user: string;
  privilege: string;
}

export async function inspectPrivileges(
  sql: Sql,
): Promise<InspectedPrivilege[]> {
  const privileges = await sql<InspectedPrivilege[]>`
    select
      table_schema as schema,
      table_name as name,
      'table' as object_type,
      grantee as user,
      privilege_type as privilege
    from
      information_schema.role_table_grants
    where
      grantee != (
        select
          tableowner
        from
          pg_tables
        where
          schemaname = table_schema
          and tablename = table_name)
      -- <EXCLUDE_INTERNAL>
      and table_schema not in ('pg_internal', 'pg_catalog', 'information_schema', 'pg_toast')
      and table_schema not like 'pg_temp_%' and table_schema not like 'pg_toast_temp_%'
      -- </EXCLUDE_INTERNAL>
    order by
      schema,
      name,
      user;
  `;

  return privileges;
}
