import type { Sql } from "postgres";

export async function extractVersion(sql: Sql) {
  const [{ version }] = await sql<{ version: number }[]>`
    select current_setting('server_version_num')::int as version;
  `;

  return version;
}
