import type {
  Pool as PgPool,
  PoolClient as PgPoolClient,
  PoolConfig as PgPoolConfig,
} from "pg";
import { escapeIdentifier, Pool, types } from "pg";

export { escapeIdentifier, Pool, types };

export type NodePgPool = PgPool;
export type NodePgPoolClient = PgPoolClient;
export type NodePgPoolConfig = PgPoolConfig;
