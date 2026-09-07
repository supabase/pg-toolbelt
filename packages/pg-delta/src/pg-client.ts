import type { Pool, PoolClient } from "pg";

const ignoreClientError = (): void => {};

/** Check out a client without leaving connection errors temporarily unhandled. */
export function connectWithErrorListener(pool: Pool): Promise<PoolClient> {
  return new Promise((resolve, reject) => {
    pool.connect((error, client, release) => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      if (client === undefined) {
        reject(new Error("pool checkout returned no client"));
        return;
      }

      client.on("error", ignoreClientError);
      client.release = (...args: Parameters<PoolClient["release"]>): void => {
        client.removeListener("error", ignoreClientError);
        client.release = release;
        release(...args);
      };
      resolve(client);
    });
  });
}
