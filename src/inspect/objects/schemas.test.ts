import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/migra/constants.ts";
import { getTest } from "../../../tests/migra/utils.ts";
import { inspectSchemas } from "./schemas.ts";

describe.concurrent(
  "inspect schemas",
  () => {
    for (const postgresVersion of POSTGRES_VERSIONS) {
      describe(`postgres ${postgresVersion}`, () => {
        const test = getTest(postgresVersion);

        test(`should be able to inspect stable properties of schemas`, async ({
          db,
        }) => {
          // arrange
          const fixture = /* sql */ `
            create schema test_schema;
          `;
          await Promise.all([db.a.unsafe(fixture), db.b.unsafe(fixture)]);
          // act
          const resultA = await inspectSchemas(db.a);
          const resultB = await inspectSchemas(db.b);
          // assert
          expect(resultA).toEqual(
            new Map([
              [
                "public",
                {
                  owner: "pg_database_owner",
                  schema: "public",
                  dependent_on: [],
                  dependents: [],
                },
              ],
              [
                "test_schema",
                {
                  owner: "test",
                  schema: "test_schema",
                  dependent_on: [],
                  dependents: [],
                },
              ],
            ]),
          );
          expect(resultB).toEqual(resultA);
        });
      });
    }
  },
  30_000,
);
