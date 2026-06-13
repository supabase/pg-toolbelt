/**
 * Shared helper: create a pg.Pool from a connection URL and provide a
 * dispose function so callers always end the pool.
 */
import pg from "pg";

export interface ManagedPool {
  pool: pg.Pool;
  end(): Promise<void>;
}

export function makePool(url: string): ManagedPool {
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  pool.on("error", () => {});
  return {
    pool,
    end: () => pool.end(),
  };
}
