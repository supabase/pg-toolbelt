import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/migra/constants.ts";
import { getTest } from "../../../tests/migra/utils.ts";
import { inspectVersion } from "./version.ts";

describe.concurrent(
  "inspect version",
  () => {
    const assertions = new Map([
      ["15", 150013],
      ["16", 160009],
      ["17", 170005],
    ]);
    for (const postgresVersion of POSTGRES_VERSIONS) {
      describe(`postgres ${postgresVersion}`, () => {
        const test = getTest(postgresVersion);

        test(`should be able to inspect PostgreSQL version`, async ({ db }) => {
          // act
          const resultA = await inspectVersion(db.a);
          const resultB = await inspectVersion(db.b);

          // assert
          const assertion =
            assertions.get(`${postgresVersion}`) === undefined
              ? assertions.get("default")
              : assertions.get(`${postgresVersion}`);
          expect(resultA.version).toBe(assertion);
          expect(resultA).toEqual(resultB);
        });
      });
    }
  },
  30_000,
);
