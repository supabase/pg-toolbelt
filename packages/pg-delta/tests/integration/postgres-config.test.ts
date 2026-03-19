import { describe, expect, test } from "bun:test";
import { createPool, endPool } from "../../src/core/postgres-config.ts";
import {
  POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG,
  POSTGRES_VERSIONS,
} from "../constants.ts";
import { PostgresAlpineContainer } from "../postgres-alpine.ts";

function suppressShutdownError(err: Error & { code?: string }) {
  if (err.code === "57P01" || err.code === "53100") return;
  console.error("Pool error:", err);
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

const CLIENT_QUERY_DEPRECATION_WARNING_FRAGMENT =
  "client is already executing a query";
// Multiple queued queries against a max=1 pool make the setup/query overlap deterministic.
const CONCURRENT_QUERY_COUNT = 8;
// Give blocked queries a brief chance to resolve if they are not waiting for setup.
const BLOCKED_QUERY_CHECK_DELAY_MS = 10;

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`postgres config (pg${pgVersion})`, () => {
    test("pool queries wait for async onConnect setup", async () => {
      const image = `postgres:${POSTGRES_VERSION_TO_ALPINE_POSTGRES_TAG[pgVersion]}`;
      const container = await new PostgresAlpineContainer(image).start();
      const warnings: string[] = [];
      let setupCompletedCount = 0;
      const setupStarted = createDeferred();
      const setupGate = createDeferred();
      const onWarning = (warning: Error) => {
        if (
          warning.message.includes(CLIENT_QUERY_DEPRECATION_WARNING_FRAGMENT)
        ) {
          warnings.push(warning.message);
        }
      };

      process.on("warning", onWarning);

      const pool = createPool(container.getConnectionUri(), {
        max: 1,
        onError: suppressShutdownError,
        onConnect: async (client) => {
          setupStarted.resolve();
          await setupGate.promise;
          await client.query("SET application_name = 'pgdelta_onconnect'");
          setupCompletedCount += 1;
        },
      });

      try {
        let queriesResolved = false;
        const queryBatch = Promise.all(
          Array.from({ length: CONCURRENT_QUERY_COUNT }, () =>
            pool.query(
              "SELECT current_setting('application_name') AS application_name",
            ),
          ),
        ).then((results) => {
          queriesResolved = true;
          return results;
        });

        await setupStarted.promise;
        await new Promise((resolve) =>
          setTimeout(resolve, BLOCKED_QUERY_CHECK_DELAY_MS),
        );
        expect(queriesResolved).toBeFalse();

        setupGate.resolve();
        const results = await queryBatch;

        for (const result of results) {
          expect(result.rows[0]?.application_name).toBe("pgdelta_onconnect");
        }
        expect(setupCompletedCount).toBe(1);
        expect(warnings).toEqual([]);
      } finally {
        process.off("warning", onWarning);
        await endPool(pool);
        await container.stop();
      }
    }, 120_000);
  });
}
