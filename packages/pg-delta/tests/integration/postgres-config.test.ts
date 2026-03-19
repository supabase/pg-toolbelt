import { describe, expect, test } from "bun:test";
import { createPool, endPool } from "../../src/core/postgres-config.ts";
import {
  POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG,
  type PostgresVersion,
} from "../constants.ts";
import { PostgresAlpineContainer } from "../postgres-alpine.ts";

function suppressShutdownError(err: Error & { code?: string }) {
  if (err.code === "57P01" || err.code === "53100") return;
  console.error("Pool error:", err);
}

const CLIENT_QUERY_DEPRECATION_WARNING =
  "Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0. Use async/await or an external async flow control mechanism instead.";

const POSTGRES_VERSIONS: PostgresVersion[] = [17];

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`postgres config (pg${pgVersion})`, () => {
    test("pool queries wait for async onConnect setup", async () => {
      const image = `postgres:${POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG[pgVersion]}`;
      const container = await new PostgresAlpineContainer(image).start();
      const warnings: string[] = [];
      const onWarning = (warning: Error) => {
        if (warning.message === CLIENT_QUERY_DEPRECATION_WARNING) {
          warnings.push(warning.message);
        }
      };

      process.on("warning", onWarning);

      const pool = createPool(container.getConnectionUri(), {
        max: 1,
        onError: suppressShutdownError,
        onConnect: async (client) => {
          await new Promise((resolve) => setTimeout(resolve, 25));
          await client.query("SET application_name = 'pgdelta_onconnect'");
        },
      });

      try {
        const results = await Promise.all(
          Array.from({ length: 8 }, () =>
            pool.query(
              "SELECT current_setting('application_name') AS application_name",
            ),
          ),
        );

        for (const result of results) {
          expect(result.rows[0]?.application_name).toBe("pgdelta_onconnect");
        }
        expect(warnings).toEqual([]);
      } finally {
        process.off("warning", onWarning);
        await endPool(pool);
        await container.stop();
      }
    }, 120_000);
  });
}
