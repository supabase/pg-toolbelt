import { sql } from "@ts-safeql/sql-tag";
import type { Pool } from "pg";
import type { Catalog } from "./catalog.model.ts";

/**
 * Context for diff operations, containing both source and target catalogs.
 */
export interface DiffContext {
  mainCatalog: Catalog;
  branchCatalog: Catalog;
}

export async function extractVersion(pool: Pool) {
  const { rows } = await pool.query<{ version: number }>(
    sql`select current_setting('server_version_num')::int as version`,
  );

  return rows[0].version;
}

export async function extractCurrentUser(pool: Pool) {
  const { rows } = await pool.query<{ current_user: string }>(
    sql`select quote_ident(current_user) as current_user`,
  );
  return rows[0].current_user;
}
